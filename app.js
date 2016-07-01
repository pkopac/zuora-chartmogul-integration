/* eslint no-process-exit: 0, no-console: ["error", { allow: ["error", "log"] }] */
"use strict";

var Q = require("q"),
    fs = require("fs"),
    minimist = require("minimist");

Q.longStackSupport = true; //DEBUG!

var Loader = require("./loader.js").Loader;
var Transformer = require("./transformer.js").Transformer;
var log4js = require("log4js");
var logger = log4js.getLogger("app");

const DEFAULT_CONFIG_PATH = "/etc/zuora-chartmogul/config.json";

var argv;

function printHelpAndExit() {
    console.error("Integrate Zuora and ChartMogul.");
    console.error("  -c <file>, --config <file>    Path to config.json.");
    console.error("  -i, --interactive             Run interactive ZOQL console.");
    console.error("  -o <file>, --output <file>    Path to dump data (use with -q).");
    console.error("  -q <query>, --query <query>   Run query (use with -o).");
    console.error("  -d, --dry                     Dry run doesn't interact with Chartmogul.");
    console.error("  -u, --update                  Ignore 'existing' errors while importing to Chartmogul.");
    process.exit(1);
}

function processArgs() {
    argv = minimist(process.argv.slice(2),
    { string: ["config", "query", "output"],
      boolean: ["interactive", "help", "dry", "update"],
      alias: {
          config: "c",
          interactive: "i",
          help: "h",
          query: "q",
          output: "o",
          dry: "d",
          update: "u"
      },
      "default": {
          config: DEFAULT_CONFIG_PATH,
          interactive: false
      }
    });
    if (argv.help) {
        printHelpAndExit();
    }

    logger.info("Config file path:", argv.config);
    return argv;
}

function runInteractive(configuration) {
    var InteractiveConsole = require("./interactive.js").InteractiveConsole;
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
            .then(function(fd) {
                for (var i = 0; i < jsonArray.length; i++) {
                    fs.writeSync(fd, JSON.stringify(jsonArray[i], null, 2) + "\n");
                }
            });
    }
    return aqua.zoqlRequest(query, "Batch")
        .then(function(jsonArray) {
            if (outputFile) {
                writeFile(jsonArray);
            } else {
                for (var i = 0; i < jsonArray.length; i++) {
                    console.log(JSON.stringify(jsonArray[i], null, 2));
                }
            }

        });
}

function runTransformation(configuration, dry, update) {
    var loader = new Loader();
    loader.configure(configuration.zuora);

    var Importer;
    if (dry) {
        Importer = require("./dummyImporter.js").Importer;

    } else {
        Importer = require("./importer.js").Importer;
    }
    var importer = new Importer();
    if (update) {
        configuration.chartmogul.update = true;
    }
    importer.configure(configuration.chartmogul);

    var transformer = new Transformer(loader, importer);
    transformer.configure(configuration.transformer);

    transformer.run()
        .then(() => logger.info("Processing finished successfully."))
        .catch(err => {
            /* All unhandled errors end up here -.o */
            if (err.error && err.error.invoices) {
                logger.fatal(err.error.invoices);
            } else {
                logger.fatal(err);
            }
            process.exit(err.statusCode || 1);
        });
}

(function() {
    processArgs();
    try {
        var configuration = JSON.parse(fs.readFileSync(argv.config, "utf8"));
        if(configuration.log4js) {
            log4js.configure(configuration.log4js);
        }
    } catch (error) {
        throw(error, "Couldn't load configuration file!");
    }
    if (argv.interactive) {
        runInteractive(configuration);
    } else if (argv.query) {
        runQuery(configuration, argv.query, argv.output);
    } else {
        runTransformation(configuration, argv.dry, argv.update);
    }
})();
