# Bar App Functions Overview

The folders inside `functions/` each correspond to an AWS Lambda function.

## Lambda functions

- **`getStartupData`**  
  Returns the startup payload used when the app launches.

- **`refreshOpenHours`**  
  Works together with **`fetchGoogleAPIHours`** to retrieve current open-hours data directly from Google and update the database. This process is currently triggered manually.

- **`insertUserReport`**  
  Used on the special details view. When a user marks a special for review, this function is called to insert a report record in the database.
