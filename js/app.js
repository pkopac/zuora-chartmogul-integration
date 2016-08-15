/* eslint no-process-exit: 0, no-console: ["error", { allow: ["error", "log"] }] */
"use strict";

var Q = require("q"),
    fs = require("fs"),
    VError = require("verror"),
    minimist = require("minimist"),
    YAML = require("yamljs");

Q.longStackSupport = true; //DEBUG!

//request-promise-any - register Q as preferred promise library
require("any-promise/register/q");

var Loader = require("./loader.js").Loader;
var Transformer = require("./transformer.js").Transformer;
var Cancellation = require("./cancellation.js").Cancellation;
var log4js = require("log4js");
var logger = log4js.getLogger("app");

const DEFAULT_CONFIG_PATH = "/etc/zuora-chartmogul/config.yaml";

var argv;

function printHelpAndExit() {
    console.error("Integrate Zuora and ChartMogul.");
    console.error("  -c <file>, --config <file>            Path to config.json.");
    console.error("  -d, --dry                             Dry run doesn't interact with Chartmogul.");
    console.error("  -e <output type>, --export <>         Download MRR activity data from Chartmogul. Output: [csv | json | mongo ]");
    console.error("  -h, --help                            Show this help message.");
    console.error("  -i, --interactive                     Run interactive ZOQL console.");
    console.error("  -o <file>, --output <file>            Path to dump data (use with -q or -e).");
    console.error("  -q <query>, --query <query>           Run query (use with -o).");
    console.error("  -t <type>, --type <type>              Type of export [activities | subscriptions | mrr ] (use with -e).");
    console.error("  -p '{\"start-date\": \"YYYY-MM-DD\"}'     Parameters for export as JSON.");
    console.error("    --params {}  ");
    console.error("  -u, --update                          Ignore 'existing' errors while importing to Chartmogul.");
    process.exit(1);
}

function processArgs() {
    argv = minimist(process.argv.slice(2),
    { string: ["config", "export", "output", "query", "type", "pwd"],
      boolean: ["dry", "help", "interactive", "update"],
      alias: {
          config: "c",
          dry: "d",
          export: "e",
          help: "h",
          interactive: "i",
          output: "o",
          params: "p",
          query: "q",
          type: "t",
          update: "u"
      },
      "default": {
          config: DEFAULT_CONFIG_PATH,
          export: null,
          interactive: false,
          params: "{}",
          type: "activities"
      }
    });

    if (argv.help) {
        printHelpAndExit();
    }

    logger.info("Config file path:", argv.config);
    return argv;
}

function runInteractive(configuration) {
    var InteractiveConsole = require("./extra/interactive.js").InteractiveConsole;
    var ZuoraAqua = require("./zuora.js").ZuoraAqua;
    var aqua = new ZuoraAqua();
    aqua.configure(configuration.zuora);
    (new InteractiveConsole(aqua)).run();
}

function runQuery(configuration, query, outputFile) {
    var ZuoraAqua = require("./zuora.js").ZuoraAqua;
    var aqua = new ZuoraAqua();
    aqua.configure(configuration.zuora);
    function writeFile(jsonArray) {
        Q.ninvoke(fs, "open", outputFile, "w")
            .then(fd => fs.writeSync(fd, JSON.stringify(jsonArray, null, 2)));
    }
    return aqua.zoqlRequest(query, "Batch")
        .then(function(jsonArray) {
            if (outputFile) {
                return writeFile(jsonArray);
            } else {
                console.log(JSON.stringify(jsonArray, null, 2));
            }

        })
        .catch(err => logger.fatal(err));
}

function runTransformation(configuration, dry, update) {
    var loader = new Loader();
    loader.configure(configuration.zuora, configuration.loader);

    var Importer;
    if (dry) {
        Importer = require("./extra/dummyImporter.js").Importer;

    } else {
        Importer = require("./importer.js").Importer;
    }
    var importer = new Importer();
    if (update) {
        configuration.chartmogul.update = true;
    }
    importer.configure(configuration.chartmogul);

    var cancellation = new Cancellation(configuration.cancellation);

    var transformer = new Transformer(loader, importer, cancellation);
    transformer.configure(configuration.transformer);

    transformer.run()
        .then(() => logger.info("Processing finished successfully."))
        .catch(err => {
            /* All unhandled errors end up here -.o */
            if (err.error && err.error.invoices) {
                logger.fatal(err.error.invoices);
            } else {
                logger.fatal(err);
                logger.fatal(JSON.stringify(err, null, 2));
            }
            process.exit(err.statusCode || 1);
        })
        .done();
}

function runExport(configuration, fileType, outputFile, pwd, exportType, params) {
    var Exporter = require("./extra/exporter.js").Exporter,
        exporter = new Exporter().configure(configuration.chartmogul, configuration.export);

    var dataSource = "zuora";
    if (configuration && configuration.transformer && configuration.transformer.dataSource) {
        dataSource = configuration.transformer.dataSource;
    }
    logger.info("Export of %s to run now...", exportType);
    exporter.run(exportType, dataSource, fileType, outputFile, pwd, params)
        .done();
}

(function() {
    processArgs();
    try {
        var configuration = YAML.parse(fs.readFileSync(argv.config, "utf8"));
        if(configuration.log4js) {
            log4js.configure(configuration.log4js);
        }
    } catch (error) {
        throw new VError(error, "Couldn't load configuration file!");
    }
    if (argv.interactive) {
        runInteractive(configuration);
    } else if (argv.query) {
        runQuery(configuration, argv.query, argv.output);
    } else if (argv.export) {
        runExport(configuration, argv.export, argv.output, argv.pwd, argv.type, JSON.parse(argv.params));
    } else {
        runTransformation(configuration, argv.dry, argv.update);
    }
})();
