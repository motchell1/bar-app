const appJson = require('./app.json');

module.exports = () => ({
  ...appJson,
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo?.extra,
      GOOGLE_MAPS_MOBILE_API_KEY: process.env.GOOGLE_MAPS_MOBILE_API_KEY,
    },
  },
});
