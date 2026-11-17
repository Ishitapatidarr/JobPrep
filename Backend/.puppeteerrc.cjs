const { join } = require("path");

/**
 * Store the Chrome download inside the project so it survives from Render's build
 * step to runtime (the default ~/.cache is not kept on Render).
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
    cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
