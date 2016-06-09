# zuora-chartmogul-integration
Imports invoices from Zuora to ChartMogul. Warning: is dependent on custom field in Zuora (SamepageId).

### Interactive ZOQL Console
Contains simplistic interactive mode that allows you to test SELECTs and polls for results that are then parsed from CSV into JSON objects and nicely printed.

### Motivation
Zuora analytics not enough for SaaS business, but ChartMogul has no Zuora integration yet.

### Solution
Use REST APIs of both with transformations to load data and get charts.

### Usage
1. Put credentials in config.json, see config-template.json.
2. ```npm install```
3. ```node app.js```.

### Tests
Use ```istanbul``` for coverage and ```jasmine``` for definition of unit tests.
* Run ```npm test```.

### Implementation
NodeJS application + wrapper libs for both services.

### License
GNU GPL v3.0
