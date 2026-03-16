# Bar App Functions Overview

The folders inside `functions/` each correspond to an AWS Lambda function.

## Lambda functions

- **`getStartupData`**  
  Returns the startup payload used when the app launches.

- **`refreshOpenHours`**  
  Works together with **`fetchGoogleAPIHours`** to retrieve current open-hours data directly from Google and update the database. This process is currently triggered manually.

- **`insertUserReport`**  
  Used on the special details view. When a user marks a special for review, this function is called to insert a report record in the database.

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
