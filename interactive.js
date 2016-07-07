/* eslint no-console: ["error", { allow: ["log"] }] */
var logger = require("log4js").getLogger("interactive"),
    Q = require("q"),
    prompt = require("prompt"),
    colors = require("colors/safe");

var InteractiveConsole = function(loader) {
    this.loader = loader;
};

InteractiveConsole.prototype.loop = function () {
    return Q.ninvoke(prompt, "get", [{name: "zoql", message: "$"}])
        .then((input) => this.loader.zoqlRequest(input.zoql, "ZOQLInteractiveShell"))
        .then((result) => this.show(result))
        .catch(function(issue){
            if (issue.message !== "canceled") {
                logger.error(issue);
            }
        })
        .then(() => this.loop());
};

InteractiveConsole.prototype.run = function () {
    if (this.loader.production) {
        prompt.message = colors.red("production");
    } else {
        prompt.message = colors.green("sandbox");
    }

    prompt.delimiter = "";
    prompt.start();
    return this.loop();
};

InteractiveConsole.prototype.show = function (jsonArray) {
    console.log(JSON.stringify(jsonArray.slice(0, 10), null, 2));
    if (jsonArray.length === 0) {
        console.log("Query returned zero results.");
    } else if (jsonArray.length > 10) {
        console.log("Query returned " + jsonArray.length + " results in total.");
    }
    return jsonArray;
};

exports.InteractiveConsole = InteractiveConsole;
