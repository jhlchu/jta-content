'use strict';
var request = require('request');
const { readdirSync } = require('fs');
const path = require('path');
//.resolve(__dirname, file)

if (process.argv.length === 2) {
  console.error('Expected at least one argument!');
  process.exit(1);
}
const spaces = process.argv[2];
const access_token = process.argv[3];

const content_url = `https://cdn.contentful.com/spaces/${spaces}/environments/master/content_types?access_token=${access_token}`;


request.get({
    url: content_url,
    json: true,
    headers: {'User-Agent': 'request'}
  }, (err, res, data) => {
    if (err) {
      console.log('Error:', err);
    } else if (res.statusCode !== 200) {
      console.log('Status:', res.statusCode);
    } else {
      console.log('u gay');
      // data is already parsed as JSON:
      console.log(data);
    }
});
