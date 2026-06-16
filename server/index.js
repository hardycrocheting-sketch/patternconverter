import "dotenv/config";
import express from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePatternPdf } from "./pattern-parser.js";

const app = express();
const port = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const bucketName = process.env.SUPABASE_PATTERN_BUCKET || "interactive-patterns";

app.use(express.json({ limit: "8mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 12 },
  fileFilter: (_request, file, callback) => {
    callback(
      null,
      file.mimetype === "application/pdf" ||
        path.extname(file.originalname).toLowerCase() === ".pdf",
    );
  },
});

const graphUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  fileFilter: (_request, file, callback) => {
    callback(
      null,
      file.mimetype.startsWith("image/") ||
        [".png", ".jpg", ".jpeg", ".webp"].includes(
          path.extname(file.originalname).toLowerCase(),
        ),
    );
  },
});

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    const error = new Error(
      "Supabase is not configured yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.",
    );
    error.status = 503;
    throw error;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isAuthorized(request) {
  const configuredPassword = process.env.APP_ADMIN_PASSWORD;
  if (!configuredPassword) return true;
  return request.get("x-admin-password") === configuredPassword;
}

function requireAdmin(request, response, next) {
  if (!isAuthorized(request)) {
    return response.status(401).json({ error: "The importer password is incorrect." });
  }
  next();
}

async function ensurePatternBucket(supabase) {
  const { data, error } = await supabase.storage.getBucket(bucketName);
  if (!error && data) return;

  const { error: createError } = await supabase.storage.createBucket(bucketName, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ["application/json"],
  });
  if (createError && !createError.message.toLowerCase().includes("already")) {
    throw createError;
  }
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    authRequired: Boolean(process.env.APP_ADMIN_PASSWORD),
    supabaseConfigured: Boolean(
      process.env.SUPABASE_URL &&
        (process.env.SUPABASE_SERVICE_ROLE_KEY ||
          process.env.SUPABASE_SECRET_KEY),
    ),
  });
});

app.post("/api/auth", (request, response) => {
  if (!isAuthorized(request)) {
    return response.status(401).json({ error: "The importer password is incorrect." });
  }
  response.json({ ok: true });
});

app.post(
  "/api/parse-patterns",
  requireAdmin,
  upload.array("documents", 12),
  async (request, response) => {
    try {
      if (!request.files?.length) {
        return response.status(400).json({ error: "Add at least one PDF." });
      }

      const results = [];
      const patternType =
        request.body.patternType === "colorwork" ? "colorwork" : "c2c";
      for (const file of request.files) {
        results.push(await parsePatternPdf(file, patternType));
      }
      return response.json({ results });
    } catch (error) {
      console.error(error);
      return response.status(error.status || 422).json({
        error: error.message || "The written patterns could not be parsed.",
      });
    }
  },
);

app.post("/api/save-pattern", requireAdmin, graphUpload.array("graphs", 20), async (request, response) => {
  try {
    const pattern = JSON.parse(request.body?.pattern || "null");
    if (
      !pattern?.slug ||
      !pattern?.title ||
      (!pattern?.variants && !pattern?.steps)
    ) {
      return response.status(400).json({ error: "Pattern data is incomplete." });
    }

    const supabase = getSupabase();
    await ensurePatternBucket(supabase);

    for (const file of request.files || []) {
      const graphPath = `${pattern.slug}/assets/${file.originalname}`;
      const { error: graphError } = await supabase.storage
        .from(bucketName)
        .upload(graphPath, file.buffer, {
          contentType: file.mimetype || "image/png",
          cacheControl: "3600",
          upsert: true,
        });
      if (graphError) throw graphError;

      const { data: graphUrl } = supabase.storage
        .from(bucketName)
        .getPublicUrl(graphPath);
      const publicUrl = graphUrl.publicUrl;
      const fname = file.originalname;

      if (pattern.graphImageUrl?.endsWith(fname)) {
        pattern.graphImageUrl = publicUrl;
      }
      if (pattern.variants) {
        for (const variant of Object.values(pattern.variants)) {
          if (variant.graphImageUrl?.endsWith(fname)) {
            variant.graphImageUrl = publicUrl;
          }
        }
      }
    }

    const storagePath = `${pattern.slug}/${pattern.slug}.json`;
    const body = Buffer.from(`${JSON.stringify(pattern, null, 2)}\n`, "utf8");
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, body, {
        contentType: "application/json",
        cacheControl: "60",
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { data: publicUrl } = supabase.storage
      .from(bucketName)
      .getPublicUrl(storagePath);

    const { error: recordError } = await supabase
      .from("interactive_patterns")
      .upsert(
        {
          slug: pattern.slug,
          title: pattern.title,
          pattern_type: pattern.patternType,
          default_variant: pattern.defaultVariant || "",
          storage_bucket: bucketName,
          storage_path: storagePath,
          pattern_data: pattern,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "slug" },
      );
    if (recordError) throw recordError;

    return response.json({
      storagePath,
      publicUrl: publicUrl.publicUrl,
    });
  } catch (error) {
    console.error(error);
    return response.status(error.status || 500).json({
      error: error.message || "The pattern could not be saved to Supabase.",
    });
  }
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(projectRoot, "dist")));
  app.use((_request, response) => {
    response.sendFile(path.join(projectRoot, "dist", "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Pattern importer running at http://localhost:${port}`);
});
