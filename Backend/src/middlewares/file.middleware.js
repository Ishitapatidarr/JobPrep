const multer = require("multer")


const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 3 * 1024 * 1024 // 3MB
    },
    // Resume text is extracted with pdf-parse, so only PDFs can be processed
    fileFilter: (req, file, cb) => {
        if (file.mimetype === "application/pdf") {
            return cb(null, true)
        }
        const err = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname)
        err.message = "Only PDF resumes are supported."
        cb(err)
    }
})


module.exports = upload;