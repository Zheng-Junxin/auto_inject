(function attachResumeParser(global) {
  "use strict";

  const shared = global.AutoApplyShared;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = new Set([".txt", ".md", ".json", ".docx", ".pdf"]);

  function extensionOf(filename) {
    const match = String(filename || "").toLowerCase().match(/\.[^.]+$/u);
    return match ? match[0] : "";
  }

  function validateFile(file) {
    if (!file) {
      throw new Error("请选择简历文件");
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error("文件过大，当前限制 5MB");
    }
    const extension = extensionOf(file.name);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error("仅支持 txt、md、json、docx、pdf");
    }
    return extension;
  }

  async function parseResumeFile(file) {
    const extension = validateFile(file);
    const warnings = [];
    let text = "";

    if (extension === ".txt" || extension === ".md") {
      text = await file.text();
    } else if (extension === ".json") {
      text = jsonToResumeText(JSON.parse(await file.text()));
    } else if (extension === ".docx") {
      text = await extractDocxText(await file.arrayBuffer());
      if (!text) {
        warnings.push("DOCX 未提取到正文，可改用复制粘贴或 txt 格式");
      }
    } else if (extension === ".pdf") {
      text = extractPdfText(await file.arrayBuffer());
      warnings.push("PDF 为无依赖最佳提取，扫描件或压缩文本可能不完整");
    }

    const normalized = normalizeResumeText(text);
    if (!normalized) {
      throw new Error("未从文件中提取到可用文本");
    }

    return {
      text: normalized,
      hints: shared.extractProfileHints(normalized),
      warnings
    };
  }

  function jsonToResumeText(value) {
    if (Array.isArray(value)) {
      return value.map(jsonToResumeText).join("\n");
    }
    if (value && typeof value === "object") {
      return Object.entries(value)
        .map(([key, item]) => `${key}: ${jsonToResumeText(item)}`)
        .join("\n");
    }
    return value == null ? "" : String(value);
  }

  function normalizeResumeText(value) {
    return String(value || "")
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
      .slice(0, 60000);
  }

  async function extractDocxText(buffer) {
    const entries = readZipEntries(buffer);
    const documentEntry = entries.find((entry) => entry.name === "word/document.xml");
    if (!documentEntry) {
      return "";
    }
    const bytes = await readZipEntryBytes(buffer, documentEntry);
    const xml = new TextDecoder("utf-8").decode(bytes);
    return xmlToText(xml);
  }

  function readZipEntries(buffer) {
    const view = new DataView(buffer);
    const entries = [];
    const eocdOffset = findEndOfCentralDirectory(view);
    if (eocdOffset < 0) {
      return entries;
    }

    const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
    const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
    let offset = centralDirectoryOffset;
    const end = centralDirectoryOffset + centralDirectorySize;
    const decoder = new TextDecoder("utf-8");

    while (offset < end && view.getUint32(offset, true) === 0x02014b50) {
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);
      const nameBytes = new Uint8Array(buffer, offset + 46, nameLength);
      const name = decoder.decode(nameBytes);

      entries.push({
        name,
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });
      offset += 46 + nameLength + extraLength + commentLength;
    }

    return entries;
  }

  function findEndOfCentralDirectory(view) {
    for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) {
        return offset;
      }
    }
    return -1;
  }

  async function readZipEntryBytes(buffer, entry) {
    const view = new DataView(buffer);
    const offset = entry.localHeaderOffset;
    if (view.getUint32(offset, true) !== 0x04034b50) {
      return new Uint8Array();
    }
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataOffset = offset + 30 + nameLength + extraLength;
    const compressed = new Uint8Array(buffer, dataOffset, entry.compressedSize);

    if (entry.method === 0) {
      return compressed;
    }
    if (entry.method !== 8) {
      throw new Error("DOCX 使用了暂不支持的压缩方式");
    }
    if (!global.DecompressionStream) {
      throw new Error("当前浏览器不支持 DOCX 解压，请改用 txt 或复制粘贴");
    }

    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const response = new Response(stream);
    return new Uint8Array(await response.arrayBuffer());
  }

  function xmlToText(xml) {
    return xml
      .replace(/<w:tab\s*\/>/gu, "\t")
      .replace(/<w:br\s*\/>/gu, "\n")
      .replace(/<\/w:p>/gu, "\n")
      .replace(/<[^>]+>/gu, "")
      .replace(/&lt;/gu, "<")
      .replace(/&gt;/gu, ">")
      .replace(/&amp;/gu, "&")
      .replace(/&quot;/gu, "\"")
      .replace(/&apos;/gu, "'")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
  }

  function extractPdfText(buffer) {
    const bytes = new Uint8Array(buffer);
    const latin1 = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    const chunks = [];

    for (const match of latin1.matchAll(/\((?:\\.|[^\\)]){2,}\)/gu)) {
      chunks.push(unescapePdfString(match[0].slice(1, -1)));
    }
    for (const match of latin1.matchAll(/<([0-9A-Fa-f]{8,})>/gu)) {
      const decoded = decodePdfHex(match[1]);
      if (decoded) {
        chunks.push(decoded);
      }
    }

    return normalizeResumeText(chunks.join("\n"));
  }

  function unescapePdfString(value) {
    return value
      .replace(/\\n/gu, "\n")
      .replace(/\\r/gu, "\n")
      .replace(/\\t/gu, "\t")
      .replace(/\\\(/gu, "(")
      .replace(/\\\)/gu, ")")
      .replace(/\\\\/gu, "\\");
  }

  function decodePdfHex(hex) {
    const bytes = [];
    for (let index = 0; index < hex.length - 1; index += 2) {
      bytes.push(parseInt(hex.slice(index, index + 2), 16));
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      let text = "";
      for (let index = 2; index < bytes.length - 1; index += 2) {
        text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
      }
      return text;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  }

  global.AutoApplyResumeParser = {
    parseResumeFile,
    extractPdfText,
    extractDocxText,
    normalizeResumeText
  };
})(globalThis);
