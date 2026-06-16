import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_INTRO =
  "Follow the C2C pattern step by step online and track your progress as you crochet.";
const COLORWORK_INTRO =
  "Follow the pattern row by row online and track your progress as you crochet.";

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function variantKey(value) {
  return slugify(value) || "variant";
}

function newVariant(file = null, index = 0) {
  const filename = file?.name?.replace(/\.[^.]+$/, "") || "";
  const guessedLabel =
    filename.match(/\b(twin|queen|king|throw|baby|lapghan)\b/i)?.[1] || "";
  return {
    id: crypto.randomUUID(),
    file,
    label: guessedLabel
      ? guessedLabel[0].toUpperCase() + guessedLabel.slice(1).toLowerCase()
      : `Size ${index + 1}`,
    approxSize: "",
    parsed: null,
  };
}

function yarnDetailFromParsed(parsed) {
  if (!parsed?.skeins) return "";
  return Object.entries(parsed.skeins)
    .map(([color, skeins]) => `${color} - ${skeins} ${skeins === 1 ? "skein" : "skeins"}`)
    .join(", ");
}

function Icon({ name }) {
  const paths = {
    upload: (
      <>
        <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
        <path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7" />
        <path d="M10 11v5m4-5v5" />
      </>
    ),
    download: (
      <>
        <path d="M12 4v11m0 0-4-4m4 4 4-4" />
        <path d="M5 20h14" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="7" ry="3" />
        <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function Field({ label, hint, children, wide = false }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  );
}

function App() {
  const fileInput = useRef(null);
  const graphInput = useRef(null);
  const [patternType, setPatternType] = useState("c2c");
  const [graphFiles, setGraphFiles] = useState([]);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [intro, setIntro] = useState(DEFAULT_INTRO);
  const [hook, setHook] = useState("5.0 mm crochet hook");
  const [otherMaterials, setOtherMaterials] = useState(
    "Tapestry needle, scissors, stitch markers",
  );
  const [colors, setColors] = useState([]);
  const [variants, setVariants] = useState([]);
  const [defaultVariantId, setDefaultVariantId] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [supabaseConfigured, setSupabaseConfigured] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [adminPassword, setAdminPassword] = useState(
    sessionStorage.getItem("patternjson-admin-password") || "",
  );
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((data) => {
        const needsAuth = Boolean(data.authRequired);
        setAuthRequired(needsAuth);
        setAuthenticated(!needsAuth);
        setSupabaseConfigured(Boolean(data.supabaseConfigured));
        if (needsAuth && adminPassword) {
          authenticate(adminPassword);
        }
      })
      .catch(() => setSupabaseConfigured(false));
  }, []);

  async function authenticate(password = adminPassword) {
    setLoginError("");
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "x-admin-password": password },
    });
    if (!response.ok) {
      setAuthenticated(false);
      setLoginError("That importer password is incorrect.");
      return;
    }
    sessionStorage.setItem("patternjson-admin-password", password);
    setAdminPassword(password);
    setAuthenticated(true);
  }

  function adminHeaders(headers = {}) {
    return authRequired
      ? { ...headers, "x-admin-password": adminPassword }
      : headers;
  }

  function updateTitle(value) {
    setTitle(value);
    if (!slugEdited) setSlug(slugify(value.replace(/\bpattern\b/gi, "")));
  }

  function selectPatternType(nextType) {
    setPatternType(nextType);
    setIntro(nextType === "c2c" ? DEFAULT_INTRO : COLORWORK_INTRO);
    setVariants([]);
    setColors([]);
    setDefaultVariantId("");
    setGraphFiles([]);
    setStatus("idle");
    setMessage("");
  }

  async function parseVariants(nextVariants, successMessage) {
    if (!nextVariants.length) return;

    const form = new FormData();
    nextVariants.forEach((variant) => form.append("documents", variant.file));
    form.append("patternType", patternType);
    setStatus("loading");
    setMessage(`Reading ${nextVariants.length} written pattern file(s)...`);

    try {
      const response = await fetch("/api/parse-patterns", {
        method: "POST",
        headers: adminHeaders(),
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      const parsedByFile = new Map(
        data.results.map((result) => [result.sourceFile, result]),
      );
      setVariants((current) =>
        current.map((variant) => ({
          ...variant,
          parsed: parsedByFile.get(variant.file.name) || variant.parsed,
        })),
      );
      addDetectedColors(data.results);
      setStatus("success");
      setMessage(
        successMessage ||
          `${data.results.reduce((sum, item) => sum + item.rowCount, 0)} rows validated across ${data.results.length} variant(s).`,
      );
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "The files could not be parsed.");
    }
  }

  async function addFiles(files) {
    const pdfs = [...files].filter(
      (file) =>
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"),
    );
    const accepted = patternType === "colorwork" ? pdfs.slice(0, 1) : pdfs;
    const added = accepted.map((file, index) =>
      newVariant(file, variants.length + index),
    );
    setVariants((current) =>
      patternType === "colorwork" ? added : [...current, ...added],
    );
    setDefaultVariantId((selected) => selected || added[0]?.id || "");
    await parseVariants(
      added,
      `${added.length} PDF${added.length === 1 ? "" : "s"} read. Add the hex value for each detected color.`,
    );
  }

  function updateVariant(id, patch) {
    setVariants((current) =>
      current.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant)),
    );
  }

  function removeVariant(id) {
    setVariants((current) => {
      const next = current.filter((variant) => variant.id !== id);
      if (defaultVariantId === id) setDefaultVariantId(next[0]?.id || "");
      return next;
    });
  }

  function updateColor(index, patch) {
    setColors((current) =>
      current.map((color, colorIndex) =>
        colorIndex === index ? { ...color, ...patch } : color,
      ),
    );
  }

  function addDetectedColors(parsedResults) {
    const detected = [
      ...new Set(parsedResults.flatMap((result) => result.colors || [])),
    ];
    setColors((current) => {
      const known = new Set(current.map((color) => color.name.toLowerCase()));
      return [
        ...current,
        ...detected
          .filter((name) => !known.has(name.toLowerCase()))
          .map((name) => ({ name, hex: "" })),
      ];
    });
  }

  async function parseFiles() {
    if (!variants.length) {
      setStatus("error");
      setMessage("Add at least one written pattern PDF.");
      return;
    }

    await parseVariants(variants);
  }

  const expectedGraphFiles = useMemo(() => {
    if (!slug) return [];
    if (patternType === "colorwork") {
      return [`${slugify(slug)}-graph.png`];
    }
    return variants.map((v) => `${slugify(slug)}-${variantKey(v.label)}-graph.png`);
  }, [patternType, slug, variants]);

  const pattern = useMemo(() => {
    if (!title.trim() || !slug.trim() || variants.some((item) => !item.parsed)) {
      return null;
    }

    const colorMap = Object.fromEntries(
      colors
        .filter((color) => color.name.trim())
        .map((color) => [color.name.trim(), color.hex || "#888888"]),
    );
    const defaultVariant =
      variants.find((item) => item.id === defaultVariantId) || variants[0];

    if (patternType === "colorwork") {
      const variant = variants[0];
      return {
        slug: slugify(slug),
        title: title.trim(),
        patternType: "row",
        approxSize: variant.approxSize.trim(),
        graphImageUrl: `graphImages/${slugify(slug)}-graph.png`,
        graphImageAlt: `${title.trim()} graph`,
        intro: intro.trim(),
        colors: colorMap,
        materials: [
          { label: "Hook", detail: hook.trim() },
          {
            label: "Yarn - based on a 200-yard skein",
            detail: yarnDetailFromParsed(variant.parsed),
          },
          { label: "Other", detail: otherMaterials.trim() },
        ],
        steps: variant.parsed.steps,
      };
    }

    return {
      slug: slugify(slug),
      title: title.trim(),
      patternType: "c2c",
      defaultVariant: variantKey(defaultVariant.label),
      intro: intro.trim(),
      colors: colorMap,
      variants: Object.fromEntries(
        variants.map((variant) => {
          const key = variantKey(variant.label);
          return [
            key,
            {
              label: variant.label.trim(),
              approxSize: variant.approxSize.trim(),
              graphImageUrl: `graphImages/${slugify(slug)}-${key}-graph.png`,
              graphImageAlt: `${title.trim()} ${variant.label.trim()} graph`,
              materials: [
                { label: "Hook", detail: hook.trim() },
                {
                  label: "Yarn - based on a 200-yard skein",
                  detail: yarnDetailFromParsed(variant.parsed),
                },
                { label: "Other", detail: otherMaterials.trim() },
              ],
              steps: variant.parsed.steps,
            },
          ];
        }),
      ),
    };
  }, [
    colors,
    defaultVariantId,
    hook,
    intro,
    otherMaterials,
    patternType,
    slug,
    title,
    variants,
  ]);

  function validateMetadata() {
    if (!title.trim() || !slug.trim()) return "Add a pattern name and slug.";
    if (
      variants.some(
        (variant) =>
          (patternType === "c2c" && !variant.label.trim()) ||
          !variant.approxSize.trim(),
      )
    ) {
      return patternType === "c2c"
        ? "Add a label and approximate finished size for every variant."
        : "Add the approximate finished size.";
    }
    if (colors.some((color) => !/^#[0-9a-f]{6}$/i.test(color.hex))) {
      return "Every color needs a six-digit hex value.";
    }
    if (!pattern) return "Parse and validate the PDFs first.";
    return "";
  }

  function downloadPattern() {
    const error = validateMetadata();
    if (error) {
      setStatus("error");
      setMessage(error);
      return;
    }
    const blob = new Blob([`${JSON.stringify(pattern, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${pattern.slug}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function savePattern() {
    const error = validateMetadata();
    if (error) {
      setStatus("error");
      setMessage(error);
      return;
    }

    setStatus("loading");
    const graphCount = graphFiles.length;
    setMessage(`Publishing pattern JSON${graphCount ? ` and ${graphCount} graph image${graphCount === 1 ? "" : "s"}` : ""} to Supabase...`);
    try {
      const form = new FormData();
      form.append("pattern", JSON.stringify(pattern));
      graphFiles.forEach((file) => form.append("graphs", file));
      const response = await fetch("/api/save-pattern", {
        method: "POST",
        headers: adminHeaders(),
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStatus("success");
      setMessage(`Saved to ${data.storagePath}`);
    } catch (saveError) {
      setStatus("error");
      setMessage(saveError.message || "The pattern could not be saved.");
    }
  }

  const parsedCount = variants.filter((variant) => variant.parsed).length;

  if (authRequired && !authenticated) {
    return (
      <main className="login-shell">
        <form
          className="login-card"
          onSubmit={(event) => {
            event.preventDefault();
            authenticate();
          }}
        >
          <span className="brand-mark">{"{ }"}</span>
          <h1>PatternJSON</h1>
          <p>This private importer requires your owner password.</p>
          <label>
            Importer password
            <input
              type="password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </label>
          {loginError && <span className="login-error">{loginError}</span>}
          <button type="submit">Open importer</button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">{"{ }"}</span>
          <div>
            <strong>PatternJSON</strong>
            <small>C2C and colorwork importer</small>
          </div>
        </div>
        <div className={`connection ${supabaseConfigured ? "ready" : ""}`}>
          <span />
          {supabaseConfigured ? "Supabase connected" : "Supabase setup needed"}
        </div>
      </header>

      <section className="hero">
        <div>
          <h1>Written patterns in. Interactive JSON out.</h1>
          <p>
            Add every size, enter the pattern details once, and validate hundreds
            of written rows without an AI service.
          </p>
        </div>
        <div className="hero-count">
          <strong>{variants.length}</strong>
          <span>{patternType === "c2c" ? "size variants" : "pattern file"}</span>
        </div>
      </section>

      <section className="form-section">
        <div className="section-heading">
          <span>01</span>
          <div>
            <h2>Pattern details</h2>
            <p>Shared information used by every size.</p>
          </div>
        </div>
        <div className="form-grid">
          <div className="pattern-type-field wide">
            <span>Pattern type</span>
            <div className="type-options">
              <button
                className={patternType === "c2c" ? "selected" : ""}
                type="button"
                onClick={() => selectPatternType("c2c")}
              >
                <strong>C2C</strong>
                <small>Diagonal blocks, often multiple sizes</small>
              </button>
              <button
                className={patternType === "colorwork" ? "selected" : ""}
                type="button"
                onClick={() => selectPatternType("colorwork")}
              >
                <strong>Colorwork</strong>
                <small>Row-by-row stitches, usually one size</small>
              </button>
            </div>
          </div>
          <Field label="Pattern name">
            <input
              value={title}
              onChange={(event) => updateTitle(event.target.value)}
              placeholder="Cute Pig C2C Pattern"
            />
          </Field>
          <Field label="Slug" hint="used for the JSON and graph filenames">
            <input
              value={slug}
              onChange={(event) => {
                setSlugEdited(true);
                setSlug(slugify(event.target.value));
              }}
              placeholder="cute-pig-c2c"
            />
          </Field>
          <Field label="Intro text" wide>
            <textarea value={intro} onChange={(event) => setIntro(event.target.value)} />
          </Field>
          <Field label="Hook">
            <input value={hook} onChange={(event) => setHook(event.target.value)} />
          </Field>
          <Field label="Other materials">
            <input
              value={otherMaterials}
              onChange={(event) => setOtherMaterials(event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="form-section">
        <div className="section-heading with-action">
          <span>02</span>
          <div>
            <h2>Color palette</h2>
            <p>Color names appear automatically when a PDF is uploaded.</p>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() =>
              setColors((current) => [...current, { name: "", hex: "#888888" }])
            }
          >
            <Icon name="plus" /> Add color
          </button>
        </div>
        <div className="color-grid">
          {colors.map((color, index) => (
            <div className="color-row" key={`${index}-${color.name}`}>
              <input
                className="color-picker"
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(color.hex) ? color.hex : "#888888"}
                onChange={(event) => updateColor(index, { hex: event.target.value })}
                aria-label={`${color.name || "New color"} picker`}
              />
              <input
                value={color.name}
                onChange={(event) => updateColor(index, { name: event.target.value })}
                placeholder="Color name"
              />
              <input
                className="hex-input"
                value={color.hex}
                onChange={(event) => updateColor(index, { hex: event.target.value })}
                placeholder="Enter hex, e.g. #000000"
              />
              <button
                className="icon-button"
                type="button"
                onClick={() =>
                  setColors((current) =>
                    current.filter((_, colorIndex) => colorIndex !== index),
                  )
                }
                aria-label={`Remove ${color.name || "color"}`}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="form-section variants-section">
        <div className="section-heading with-action">
          <span>03</span>
          <div>
            <h2>
              {patternType === "c2c"
                ? "Written pattern sizes"
                : "Written colorwork pattern"}
            </h2>
            <p>
              {patternType === "c2c"
                ? "Choose one separately written PDF for each size variant."
                : "Choose the row-by-row written colorwork PDF."}
            </p>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="upload" /> Add PDFs
          </button>
          <input
            ref={fileInput}
            hidden
            multiple
            type="file"
            accept=".pdf,application/pdf"
            onChange={(event) => addFiles(event.target.files)}
          />
        </div>

        {!variants.length ? (
          <button
            className="empty-upload"
            type="button"
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="upload" />
            <strong>Add written pattern PDFs</strong>
            <span>
              {patternType === "c2c"
                ? "You can select Twin, Queen, King, and other sizes together."
                : "Colorwork patterns normally use one PDF and one finished size."}
            </span>
          </button>
        ) : (
          <div className="variant-list">
            {variants.map((variant) => (
              <article className="variant-card" key={variant.id}>
                <div className="file-summary">
                  <span className="pdf-badge">PDF</span>
                  <div>
                    <strong>{variant.file.name}</strong>
                    <span>
                      {variant.parsed
                        ? `${variant.parsed.rowCount} rows validated`
                        : "Waiting to parse"}
                    </span>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => removeVariant(variant.id)}
                    aria-label={`Remove ${variant.file.name}`}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
                <div className="variant-fields">
                  {patternType === "c2c" && (
                    <Field label="Variant label">
                      <input
                        value={variant.label}
                        onChange={(event) =>
                          updateVariant(variant.id, { label: event.target.value })
                        }
                        placeholder="Queen"
                      />
                    </Field>
                  )}
                  <Field
                    label="Approximate finished size"
                    wide={patternType === "colorwork"}
                  >
                    <input
                      value={variant.approxSize}
                      onChange={(event) =>
                        updateVariant(variant.id, { approxSize: event.target.value })
                      }
                      placeholder="90 x 90 in"
                    />
                  </Field>
                  {variant.parsed && (
                    <div className="yarn-estimate wide">
                      <span>
                        Estimated yarn from{" "}
                        {variant.parsed.unitsPerSkein.toLocaleString()}{" "}
                        {patternType === "c2c" ? "blocks" : "stitches"} per
                        200-yard skein
                      </span>
                      <strong>{yarnDetailFromParsed(variant.parsed)}</strong>
                    </div>
                  )}
                  {patternType === "c2c" && (
                    <label className="default-choice">
                      <input
                        type="radio"
                        name="defaultVariant"
                        checked={defaultVariantId === variant.id}
                        onChange={() => setDefaultVariantId(variant.id)}
                      />
                      Default size
                    </label>
                  )}
                </div>
                {variant.parsed && (
                  <div className="parse-report">
                    <span>{variant.parsed.colors.length} colors</span>
                    <span>
                      {patternType === "c2c"
                        ? `Corners: ${variant.parsed.cornerRows.join(", ") || "inferred"}`
                        : `${variant.parsed.steps[0]?.totalStitches || 0} stitches per first row`}
                    </span>
                    <span>
                      Graph:{" "}
                      {patternType === "c2c"
                        ? `${slugify(slug)}-${variantKey(variant.label)}-graph.png`
                        : `${slugify(slug)}-graph.png`}
                    </span>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="form-section">
        <div className="section-heading with-action">
          <span>04</span>
          <div>
            <h2>Graph images</h2>
            <p>Upload the PNG graph(s) to save alongside the JSON in Supabase.</p>
          </div>
          <button
            className="text-button"
            type="button"
            onClick={() => graphInput.current?.click()}
          >
            <Icon name="upload" /> Add graphs
          </button>
          <input
            ref={graphInput}
            hidden
            multiple
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/*"
            onChange={(event) => setGraphFiles([...event.target.files])}
          />
        </div>
        {expectedGraphFiles.length > 0 && (
          <div className="graph-list">
            {expectedGraphFiles.map((fname) => {
              const matched = graphFiles.find((f) => f.name === fname);
              return (
                <div className="graph-row" key={fname}>
                  <span className="graph-filename">{fname}</span>
                  <span className={matched ? "graph-status ready" : "graph-status missing"}>
                    {matched ? "Ready" : "Not uploaded"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="review-section">
        <div className="review-copy">
          <span className={`status-dot ${status}`} />
          <div>
            <strong>
              {status === "loading"
                ? "Working..."
                : parsedCount === variants.length && variants.length
                  ? "Pattern data is parsed"
                  : "Ready to validate"}
            </strong>
            <p>{message || "The importer checks row order and every block total."}</p>
          </div>
        </div>
        <div className="actions">
          <button
            className="secondary-button"
            type="button"
            onClick={parseFiles}
            disabled={status === "loading"}
          >
            Validate PDFs
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={downloadPattern}
            disabled={!pattern || status === "loading"}
          >
            <Icon name="download" /> Download JSON
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={savePattern}
            disabled={!pattern || status === "loading"}
          >
            <Icon name="database" /> Save to Supabase
          </button>
        </div>
      </section>

      {pattern && (
        <details className="json-preview">
          <summary>Preview generated JSON</summary>
          <pre>{JSON.stringify(pattern, null, 2)}</pre>
        </details>
      )}
    </main>
  );
}

export default App;
