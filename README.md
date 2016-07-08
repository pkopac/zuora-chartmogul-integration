# zuora-chartmogul-integration
Imports invoices from Zuora to ChartMogul. Tries to overcome differences in data models.

### Warnings
**Work in progress.**

The transformation is dependent on custom field in Zuora (SamepageId), custom plans and custom item names.
If you want to use it, you would need to extract these into a configurable file or rewrite the hard-coded constants.

The data models are very different, for example right now Chartmogul doesn't support partial refund of invoices, so that is ignored -> the cashflow is not correct.

### Interactive ZOQL Console
Contains simplistic interactive mode that allows you to test SELECTs and polls for results that are then parsed from CSV into JSON objects and nicely printed.

You can also just run queries and save results into file as JSONs.

### Usage
1. Put credentials in config.json, see config-template.json.
2. ```npm install```
3. ```node app.js```.

Alternatively, you can build & deploy as deb package.

### Tests
Use ```istanbul``` for coverage and ```jasmine``` for definition of unit tests.
* Run ```npm test```.

### Implementation
NodeJS application + wrapper libs for both services. REST APIs of both with transformations to load data.

### License
GNU GPL v3.0
