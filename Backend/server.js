// Load Backend/.env first, before any module that reads process.env
const { ENV_PATH, ENV_VARS, envFileExists, getMissingEnv } = require("./src/config/env");

const PORT = 3000;

// Startup configuration check — never prints values, only which names are missing
const missing = getMissingEnv();

if (!envFileExists && missing.required.length) {
    console.error(`\n✖  Environment file not found: ${ENV_PATH}`);
    console.error("   Create it from Backend/.env.example and fill in your own values.");
} else if (!envFileExists) {
    console.log("ℹ  No Backend/.env file — using environment variables from the shell/host.");
}

if (missing.optional.length) {
    console.warn("\n⚠  Optional environment variables missing:");
    missing.optional.forEach(name => console.warn(`   - ${name}: ${ENV_VARS[ name ].purpose}`));
}

if (missing.required.length) {
    console.error("\n✖  Required environment variables missing in Backend/.env:");
    missing.required.forEach(name => console.error(`   - ${name}: ${ENV_VARS[ name ].purpose}`));
    console.error("\n   The server was NOT started. Add the values above to Backend/.env, then restart");
    console.error("   (type `rs` + Enter in the nodemon terminal, or run `npm run dev` again).\n");
    process.exit(1);
}

const app = require("./src/app");
const connectToDB = require("./src/config/database");

async function start() {
    try {
        await connectToDB();
    } catch (error) {
        console.error("\n✖  Could not connect to MongoDB:", error.message);
        console.error("   Check MONGO_URI in Backend/.env, your network, and (for Atlas) the IP access list.");
        console.error("   The server was NOT started.\n");
        process.exit(1);
    }

    // Only accept requests once the database is ready
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

start();
