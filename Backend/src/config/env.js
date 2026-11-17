const path = require("path")
const fs = require("fs")
const dotenv = require("dotenv")

/**
 * Single place where Backend/.env is loaded.
 * Uses an absolute path, so it works no matter which directory the server is started from.
 * Node caches this module, so dotenv runs only once even if several files require it.
 * Values are never printed — only variable names.
 */
const ENV_PATH = path.resolve(__dirname, "../../.env")

/**
 * Reads .env as text whatever encoding the editor saved it in.
 * PowerShell 5.1 (`>` / Out-File) and Notepad ("Unicode") save UTF-16 with a BOM;
 * dotenv assumes UTF-8, which garbles every key name so nothing gets loaded.
 */
function readEnvText(filePath) {
    const buf = fs.readFileSync(filePath)
    if (buf[ 0 ] === 0xFF && buf[ 1 ] === 0xFE) return buf.subarray(2).toString("utf16le")
    if (buf[ 0 ] === 0xFE && buf[ 1 ] === 0xFF) {
        // UTF-16 BE: swap byte pairs, then decode as LE
        const body = Buffer.from(buf.subarray(2))
        return body.swap16 && body.length % 2 === 0 ? body.swap16().toString("utf16le") : body.toString("utf8")
    }
    if (buf[ 0 ] === 0xEF && buf[ 1 ] === 0xBB && buf[ 2 ] === 0xBF) return buf.subarray(3).toString("utf8")
    return buf.toString("utf8")
}

const envFileExists = fs.existsSync(ENV_PATH)
if (envFileExists) {
    const parsed = dotenv.parse(readEnvText(ENV_PATH))
    // Same semantics as dotenv.config(): real shell/host variables take precedence
    for (const [ key, value ] of Object.entries(parsed)) {
        if (process.env[ key ] === undefined) process.env[ key ] = value
    }
}

/** Variables the backend needs, and what breaks without them. */
const ENV_VARS = {
    MONGO_URI: { required: true, purpose: "MongoDB connection string" },
    JWT_SECRET: { required: true, purpose: "secret used to sign login tokens" },
    NVIDIA_API_KEY: { required: false, purpose: "NVIDIA AI API key (interview plans and resume PDFs are disabled without it)" }
}

function getMissingEnv() {
    const missing = Object.keys(ENV_VARS).filter(name => !process.env[ name ] || !process.env[ name ].trim())
    return {
        required: missing.filter(name => ENV_VARS[ name ].required),
        optional: missing.filter(name => !ENV_VARS[ name ].required)
    }
}

module.exports = { ENV_PATH, ENV_VARS, envFileExists, getMissingEnv }
