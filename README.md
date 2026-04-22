# Bar App Functions Overview

The folders inside `functions/` each correspond to an AWS Lambda function.

## Lambda functions

- **`getStartupData`**  
  Returns the startup payload used when the app launches. This payload now includes only active bars and only open-hours rows for bars that currently have an active special in the returned week view. It is also responsible for sending bar metadata such as name, neighborhood, `image_url`, and `has_special_this_week`. Bars with `has_special_this_week = true` already have the detail-screen hours/specials needed by the client in startup data. `getStartupData` builds each `image_url` from `BAR_IMAGE_FOLDER_URL` + `/` + `image_file`.

- **`getBarDetails`**  
  Returns open hours and specials for a single active bar when the user opens the bar details screen. The payload also includes a lightweight `bar` object containing `bar_id` and `website_url` so the client can render the Website section even when metadata is limited in cached state. The client should call this only for bars whose details were not already included in `getStartupData` (for example, bars where `has_special_this_week = false`).

- **`refreshOpenHours`**  
  Works together with **`fetchGoogleAPIHours`** to retrieve current open-hours data directly from Google and update the database. This process is currently triggered manually.


- **`googleBarSync`**  
  This is the only entry point for the new two-Lambda bar sync flow. It accepts only `{ "neighborhood": "downtown" }`, loads the built-in neighborhood config, calls Places API (New) Text Search (`textQuery: "bar"`) using one or more configured rectangle `locationRestriction` search windows per neighborhood, dedupes results across all rectangles/pages, filters candidates to the configured polygon, formats open hours using the same structure as `fetchGoogleAPIHours`, asks `dbBarSync` (`determine_if_bar_existing`) which bars are new vs existing, fetches Google photos only for new bars using Place Photos (New), uploads those images to S3, and then calls `dbBarSync` again (`apply_bar_upsert`) to save the results. It no longer makes Place Details calls during the sync.

  Required environment variables:
  - `GOOGLE_API_KEY`
  - `S3_BUCKET_NAME`
  - `BAR_IMAGE_FOLDER`
  - `DB_BAR_SYNC_LAMBDA_NAME`
  
  Optional environment variables:
  - `NEIGHBORHOODS_JSON_PATH` (absolute/relative local file path override for `neighborhoods.json`)
  - `NEIGHBORHOODS_JSON_S3_KEY` (S3 object key in `S3_BUCKET_NAME`; used when no local file is found)

- **`dbBarSync`**  
  This Lambda is invoked only by `googleBarSync`. It handles bar-centric sync tasks. `determine_if_bar_existing` splits candidates into `new_bars` and `existing_bars` by `google_place_id`; `apply_bar_upsert` inserts new bars, upserts open-hours rows, and marks any bar whose Google `business_status` is not `OPERATIONAL` as inactive; `get_bars_by_neighborhood` returns bars for downstream jobs; `detect_duplicate_websites` returns duplicate website-domain groups among active bars for alerting workflows. It uses the same RDS connection variable pattern as the existing database Lambdas.

  Required environment variables:
  - `RDS_HOST`
  - `DB_USER`
  - `DB_PASSWORD`
  - `DB_NAME`
  - `WEB_SCRAPE_AUTO_APPROVAL_THRESHOLD` (optional; defaults to `1.0`)
  - `WEB_AI_SEARCH_AUTO_APPROVAL_THRESHOLD` (optional; defaults to `1.0`)


- **`dbSpecialSync`**  
  Handles special-candidate persistence and publish flows. `insert_special_candidate` creates a `special_candidate_run` and inserts candidate rows, and `publish_special_candidate_run` applies approved candidates to active `special` rows.

- **`dbAdminSync`**  
  Handles admin moderation workflows for specials. `get_unapproved_special_candidates` returns grouped run/special payloads for UI review, and `update_special_candidate_approval` updates one candidate to APPROVED/REJECTED and auto-publishes the run when no NOT_APPROVED non-recurring candidates remain.

- **`insertUserReport`**  
  Used on the special details view. When a user marks a special for review, this function is called to insert a report record in the database.

- **`importCSVtoDatabase`**  
  Imports bar/special/open-hours CSV files from S3 into MySQL. It supports insert (`I`), insert-or-update (`IU`), and delete (`D`) transactions, tracks row-level outcomes, and moves processed files from `data/input/` to `data/complete/` or `data/error/`. If no key is provided, it processes the oldest file in the input folder.

  Required environment variables:
  - `RDS_HOST`
  - `DB_USER`
  - `DB_PASSWORD`
  - `DB_NAME`
  - `BAR_IMAGE_FOLDER_URL` (used by `getStartupData` to build full bar image URLs from `image_file`)
  - `S3_BUCKET`
  - `S3_DATA_FOLDER`

  Required IAM permissions:
  - `s3:ListBucket` for reading `data/input/`
  - `s3:GetObject` on `data/input/*`
  - `s3:PutObject` on `data/complete/*` and `data/error/*`
  - `s3:DeleteObject` on `data/input/*`

- **`findAllBarsByNeighborhood`**  
  Searches Google Places for candidate bars in a configured neighborhood, deduplicates and filters the results, then writes a CSV to `${S3_DATA_FOLDER}/input/` for review and ingestion by `importCSVtoDatabase`. Current supported neighborhood input is `downtown`.

  Required environment variables:
  - `GOOGLE_API_KEY` (same variable name convention used by `fetchGoogleAPIHours`)
  - `S3_BUCKET`
  - `S3_DATA_FOLDER`

- **`updateDeviceFavorite`**  
  Updates records in either `device_special_favorite` or `device_bar_favorite`. Provide exactly one of `special_id` or `bar_id`. Pass `is_favorite: true` to insert (or keep) a favorite row, and `is_favorite: false` to delete the row.

  Example payload:

  ```json
  {
    "device_id": "abc123",
    "special_id": 28,
    "is_favorite": true
  }
  ```

  Or for a bar:

  ```json
  {
    "device_id": "abc123",
    "bar_id": 14,
    "is_favorite": true
  }
  ```

- **`generateCandidateSpecials`**  
  Generates and stores candidate specials for all bars in a neighborhood. It accepts `neighborhood`, invokes `dbBarSync` (`get_bars_by_neighborhood`) to fetch bars (`bar_id`, `bar_name`, `neighborhood`, `website_url`), runs crawl-first + OpenAI fallback extraction per bar, and invokes `dbSpecialSync` to insert/publish candidate results.

## Front-end integration

- Favorites are now persisted in the background whenever a user favorites/unfavorites a special or bar.
- `getStartupData` reads `device_special_favorite` and `device_bar_favorite` (when `device_id` is provided) and marks payload items with `favorite`.
- Endpoint used by the web app:
  - `https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/updateDeviceFavorite`


## Two-Lambda bar sync flow

1. Invoke `googleBarSync` with:

   ```json
   {
     "neighborhood": "downtown"
   }
   ```

2. `googleBarSync` loads the built-in neighborhood config (polygon + one or more search rectangles), runs Places Text Search for each rectangle with pagination, dedupes results, filters candidates to the polygon, and builds a bar list with formatted hours.
3. `googleBarSync` invokes `dbBarSync` mode `determine_if_bar_existing` to split candidates into `new_bars` and `existing_bars` using `google_place_id`.
4. `googleBarSync` leaves `existing_bars` alone, fetches and uploads images only for `new_bars`, and assigns each one an `image_file`.
5. `googleBarSync` invokes `dbBarSync` mode `apply_bar_upsert` a second time.
6. `dbBarSync` inserts new bars and updates open hours for both new and existing bars.
