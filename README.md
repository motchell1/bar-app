# Bar App Functions Overview

The folders inside `functions/` each correspond to an AWS Lambda function.

## Lambda functions

- **`getStartupData`**  
  Returns the startup payload used when the app launches.

- **`refreshOpenHours`**  
  Works together with **`fetchGoogleAPIHours`** to retrieve current open-hours data directly from Google and update the database. This process is currently triggered manually.

- **`insertUserReport`**  
  Used on the special details view. When a user marks a special for review, this function is called to insert a report record in the database.

- **`loadCsvToMysql`**  
  Loads CSV files from S3 into MySQL in RDS. This Lambda reads `S3_BUCKET` and `S3_DATA_FOLDER` from required environment variables, reads table name from row 1, transaction type from row 2, uses row 3 as headers, and processes rows 4+ with batch SQL operations via `executemany()`. If no `key` is provided in the event, it automatically selects the oldest file in `${S3_DATA_FOLDER}/input/`.

  Supported tables:
  - `bar`
  - `special`
  - `open_hours`

  Supported transaction types:
  - `I` = insert
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
  IU
  bar_id,name,address,neighborhood,image_url
  1,Mike's Beer Bar,123 North Shore Dr,North Shore,https://example.com/mike.jpg
  2,Cinderlands,456 Butler St,Lawrenceville,https://example.com/cinderlands.jpg
  ```

  Delete file format (`D` transaction only supports one key column):

  ```csv
  special
  D
  special_id
  55
  56
  57
  ```

  Required environment variables:
  - `RDS_HOST`
  - `DB_USER`
  - `DB_PASSWORD`
  - `DB_NAME`
  - `S3_BUCKET`
  - `S3_DATA_FOLDER`

  Required IAM permissions:
  - `s3:ListBucket` for reading `data/input/`
  - `s3:GetObject` on `data/input/*`
  - `s3:PutObject` on `data/complete/*` and `data/error/*`
  - `s3:DeleteObject` on `data/input/*`

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
