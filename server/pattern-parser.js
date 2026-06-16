import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const ROW_START = /(?:←|→)?\s*Row\s+(\d+)\s*\[(RS|WS)\]\s*:/g;
const TOTAL_UNITS =
  /\((\d+)\s+(?:(?:single\s+crochet|double\s+crochet|half\s+double\s+crochet)\s+)?(blocks?|stitches?)\)\.?/gi;
const COLOR_RUN = /\(([^()]+)\)\s*x\s*(\d+)/g;
const CORNER_MARKER = /Corner:\s*Start decreasing[^←→]*?(?=(?:←|→)?\s*Row\s+(\d+))/gi;

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

async function extractPdfText(buffer) {
  const document = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }

  return cleanText(pages.join(" "));
}

function findCornerRows(text) {
  return [...text.matchAll(CORNER_MARKER)].map((match) => Number(match[1]));
}

function getTurnText(row, rows, cornerRows) {
  if (row.number === rows.at(-1).number) return "Finish";

  const firstCorner = cornerRows[0];
  const secondCorner = cornerRows[1];
  if (row.number === firstCorner) {
    return "Start decreasing at the beginning of row";
  }
  if (row.number === secondCorner) {
    return "Start to decrease at the end of the row";
  }

  const nextRow = rows.find((candidate) => candidate.number === row.number + 1);
  if (!firstCorner) {
    return nextRow && nextRow.totalBlocks > row.totalBlocks
      ? "Increase"
      : "Decrease";
  }

  if (row.number < firstCorner - 1) return "Increase";
  return "Decrease";
}

function parseRows(text) {
  const starts = [...text.matchAll(ROW_START)];
  const rows = [];

  for (const [index, match] of starts.entries()) {
    const chunkEnd =
      starts[index + 1]?.index ?? text.indexOf("Total:", match.index);
    const chunk = text.slice(match.index + match[0].length, chunkEnd);
    const totalMatch = [...chunk.matchAll(TOTAL_UNITS)].at(-1);

    if (!totalMatch) continue;

    const instructions = cleanText(chunk.slice(0, totalMatch.index));
    const runs = [...instructions.matchAll(COLOR_RUN)].map((run) => ({
      color: cleanText(run[1]),
      count: Number(run[2]),
    }));
    const totalUnits = Number(totalMatch[1]);

    rows.push({
      number: Number(match[1]),
      side: match[2],
      instructions,
      totalUnits,
      unitType: totalMatch[2].toLowerCase().startsWith("block")
        ? "blocks"
        : "stitches",
      parsedTotal: runs.reduce((sum, run) => sum + run.count, 0),
      runs,
    });
  }

  return rows;
}

function totalColors(rows) {
  const totals = {};
  rows.forEach((row) => {
    row.runs.forEach(({ color, count }) => {
      totals[color] = (totals[color] || 0) + count;
    });
  });
  return totals;
}

function validateRows(rows) {
  if (!rows.length) {
    throw new Error(
      "No C2C rows were found. Expected lines like: Row 1 [RS]: (Color) x 1 (1 block).",
    );
  }

  const errors = [];
  rows.forEach((row, index) => {
    const expectedNumber = index + 1;
    if (row.number !== expectedNumber) {
      errors.push(`Expected row ${expectedNumber}, found row ${row.number}.`);
    }
    if (!row.runs.length) {
      errors.push(`Row ${row.number} has no color runs.`);
    }
    if (row.parsedTotal !== row.totalUnits) {
      errors.push(
        `Row ${row.number} totals ${row.parsedTotal}, but the PDF says ${row.totalUnits}.`,
      );
    }
  });

  if (errors.length) {
    throw new Error(errors.slice(0, 8).join(" "));
  }
}

export async function parsePatternPdf(file, patternType = "c2c") {
  const text = await extractPdfText(file.buffer);
  const rows = parseRows(text);
  validateRows(rows);
  const isC2c = patternType === "c2c";
  const cornerRows = isC2c ? findCornerRows(text) : [];
  const colors = [...new Set(rows.flatMap((row) => row.runs.map((run) => run.color)))];
  const unitTotals = totalColors(rows);
  const unitsPerSkein = isC2c ? 1000 : 5000;

  return {
    sourceFile: file.originalname,
    rowCount: rows.length,
    colors,
    cornerRows,
    unitTotals,
    unitsPerSkein,
    skeins: Object.fromEntries(
      Object.entries(unitTotals).map(([color, total]) => [
        color,
        Math.ceil(total / unitsPerSkein),
      ]),
    ),
    steps: rows.map((row) =>
      isC2c
        ? {
            number: row.number,
            instructions: row.instructions,
            totalBlocks: row.totalUnits,
            turnText: getTurnText(
              { ...row, totalBlocks: row.totalUnits },
              rows.map((item) => ({
                ...item,
                totalBlocks: item.totalUnits,
              })),
              cornerRows,
            ),
          }
        : {
            number: row.number,
            side: row.side,
            instructions: row.instructions.replace(/[()]/g, ""),
            totalStitches: row.totalUnits,
          },
    ),
  };
}
