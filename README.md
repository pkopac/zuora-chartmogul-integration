# zuora-chartmogul-integration
Imports invoices from Zuora to ChartMogul. Tries to overcome differences in data models.

### Warning

The transformation is dependent on custom field in Zuora (SamepageId), custom plans and custom item names.
If you want to use the integration, you need to extract these into a configurable file or rewrite the hard-coded constants.
We will probably accept pull requests as long as they don't break original functionality.

The data models are very different, for example right now ChartMogul doesn't support partial refund of invoices, so that is ignored -> the cashflow is not correct.
Also it depends how the users create/cancel/change invoices in Zuora, because it allows many possibilities which are not in ChartMogul (eg. credit, adjustments).

### Installation
1. Download/Fork the project
2. Put credentials and other configuration in config.yaml, see config-template.yaml.
3. ```npm install```
4. ```node app.js```

Alternatively, you can build the deb package for Debian-based Linux distros and then execute it as ```zuora-chartmogul```.

### Interactive ZOQL Console
Contains simplistic interactive mode ```-i``` that allows you to test SELECTs and polls for results
that are then parsed from CSV into JSON objects and nicely printed.

You can also just run queries with ```-q``` and save results into file as JSONs.

### Exports from ChartMogul
[CM has Metrics API](https://dev.chartmogul.com/docs/retrieve-mrr) which can be used with ```-e -t```
to get data for checking or further processing. Supported types are listed in ```--help```.

### Tests
Uses ```istanbul``` for coverage and ```jasmine``` for definition of unit tests.
* Run ```npm test```.

### Implementation
NodeJS application + custom wrapper libs for both services. The Zuora lib is part of this project.
REST APIs of both with transformations (most of business logic) to load data.

### License
GNU GPL v3.0
