/* eslint no-process-exit: 0, no-console: ["error", { allow: ["error"] }] */
"use strict";

var //Q = require("q"),
    fs = require("fs"),
    minimist = require("minimist");

var Loader = require("./loader.js").Loader;
var Importer = require("./importer.js").Importer;
var Transformer = require("./transformer.js").Transformer;

var logger = require("log4js").getLogger();
logger.setLevel("TRACE");

const DEFAULT_CONFIG_PATH = "/etc/zuora-chartmogul/config.json";

var argv;

function printHelpAndExit() {
    console.error("Integrate Zuora and ChartMogul.");
    console.error("  -c <file>, --config <file>    Path to config.json.");
    console.error("  -i, --interactive             Run interactive ZOQL console.");
    process.exit(1);
}

function processArgs() {
    argv = minimist(process.argv.slice(2),
    { string: ["config"],
      boolean: ["interactive", "help"],
      alias: {config: "c",
              interactive: "i",
              help: "h"},
      "default": {config: DEFAULT_CONFIG_PATH, interactive: false}
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

function runTransformation(configuration) {
    var loader = new Loader();
    loader.configure(configuration.zuora);

    var importer = new Importer();
    importer.configure(configuration.chartmogul);

    var transformer = new Transformer(loader, importer);
    transformer.configure(configuration.transformer);

    transformer.run()
        .catch(err => logger.error(err));
}

(function() {
    processArgs();
    var configuration = JSON.parse(fs.readFileSync(argv.config, "utf8"));

    if (argv.interactive) {
        runInteractive(configuration);
    } else {
        runTransformation(configuration);
    }
})();
