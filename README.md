# Bar App Functions Overview

The folders inside `functions/` each correspond to an AWS Lambda function.

## Lambda functions

- **`getStartupData`**  
  Returns the startup payload used when the app launches. This payload now includes only active bars and only open-hours rows for bars that currently have an active special in the returned week view. It is also responsible for sending bar metadata such as name, neighborhood, `image_url`, and `has_special_this_week`. Bars with `has_special_this_week = true` already have the detail-screen hours/specials needed by the client in startup data. `getStartupData` builds each `image_url` from `BAR_IMAGE_FOLDER_URL` + `/` + `image_file`.

- **`getBarDetails`**  
  Returns only open hours and specials for a single active bar when the user opens the bar details screen. It should not return bar name, image, or other bar metadata because the client already has that from `getStartupData`. The client should call this only for bars whose details were not already included in `getStartupData` (for example, bars where `has_special_this_week = false`).

- **`refreshOpenHours`**  
  Works together with **`fetchGoogleAPIHours`** to retrieve current open-hours data directly from Google and update the database. This process is currently triggered manually.

- **`insertUserReport`**  
  Used on the special details view. When a user marks a special for review, this function is called to insert a report record in the database.

- **`importCSVtoDatabase`**  
  Loads CSV files from S3 into MySQL in RDS. This Lambda reads `S3_BUCKET` and `S3_DATA_FOLDER` from required environment variables, reads table name from row 1, transaction type from row 2, uses row 3 as headers, and processes rows 4+ with batch SQL operations via `executemany()`. If no `key` is provided in the event, it automatically selects the oldest file in `${S3_DATA_FOLDER}/input/`.

  Supported tables:
  - `bar`
  - `special`
  - `open_hours`

  Supported transaction types:
  - `I` = insert
  - `II` = insert ignore (`INSERT IGNORE`)
  - `IU` = insert/update (`ON DUPLICATE KEY UPDATE`)
  - `D` = delete

  S3 file flow:
  - incoming files: `data/input/`
  - successful files: `data/complete/`
  - failed files: `data/error/`

  Files are moved using S3 copy + delete, with a UTC timestamp prefix added to avoid overwrites.

  Example event payload:

  ```json
  {}
  ```

  CSV format:

  ```csv
  bar
  II
  bar_id,name,address,neighborhood,image_file
  1,Mike's Beer Bar,123 North Shore Dr,North Shore,mike.jpg
  2,Cinderlands,456 Butler St,Lawrenceville,cinderlands.jpg
  ```

  Delete file format (`D` transaction):

  Option 1 — provide primary key column(s) directly (fastest):

  ```csv
  special
  D
  special_id
  55
  56
  57
  ```

  Option 2 — provide non-primary-key lookup columns. The Lambda will run a `SELECT` using the provided header columns to find the matching row, resolve its primary key, and then delete by primary key:

  ```csv
  bar
  D
  name,google_place_id,neighborhood
  Some Bar,ChIJ123,North Shore
  ```

  Notes for `D` transactions:
  - If the CSV includes all primary key column(s), delete runs directly by primary key.
  - If the CSV omits primary key column(s), each row must match exactly one database row; zero or multiple matches return an error.
  - Composite primary keys are supported.

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
  Searches Google Places for bar candidates in a configured Pittsburgh neighborhood, filters and deduplicates results, generates a CSV using the existing import structure, and uploads it to the S3 import folder for manual review before running `importCSVtoDatabase`.

  Supported input:
  - `neighborhood` (string key from neighborhood config; currently supports `downtown`)

  Example event payload:

  ```json
  {
    "neighborhood": "downtown"
  }
  ```

  Required environment variables:
  - `GOOGLE_API_KEY` (same variable name convention used by `fetchGoogleAPIHours`)
  - `S3_BUCKET`
  - `S3_DATA_FOLDER`

  High-level flow:
  1. Load neighborhood config.
  2. Run Google Places text searches.
  3. Deduplicate by `google_place_id`.
  4. Apply polygon filter.
  5. Apply restaurant-with-bar filter.
  6. Generate CSV in existing import format.
  7. Upload CSV to S3 import folder.
  8. Manually review CSV.
  9. Process CSV with `importCSVtoDatabase`.

  CSV structure used:
  - row 1 = table name
  - row 2 = transaction code
  - row 3 = column names
  - row 4+ = data rows

  Current CSV output rows are (using insert-ignore so duplicate bars already in the database are skipped):

  ```csv
  bar
  II
  name,google_place_id,address,neighborhood,is_active
  ```

  S3 destination pattern:
  - `${S3_DATA_FOLDER}/input/bar_import_<neighborhood>_<timestamp>.csv`

  Design note:
  - The Lambda is neighborhood-config driven so additional neighborhoods can be added later by configuration (for example North Shore, Strip District, Lawrenceville, Shadyside) without rewriting the import flow.

- **`updateDeviceFavorite`**  
  Updates records in `device_favorite` for a given `device_id` and `special_id`. Pass `is_favorite: true` to insert (or keep) a favorite row, and `is_favorite: false` to delete the row.

  Example payload:

  ```json
  {
    "device_id": "abc123",
    "special_id": 28,
    "is_favorite": true
  }
  ```

## Front-end integration

- Favorites are now persisted in the background whenever a user favorites/unfavorites a special.
- Endpoint used by the web app:
  - `https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/updateDeviceFavorite`
