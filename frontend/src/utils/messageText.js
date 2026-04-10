/** Plain text for clipboard (user messages). */
export function userContentToPlainText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const bits = [];
  for (const p of content) {
    if (p.type === "text" && p.text) bits.push(p.text);
    else if (p.type === "image_url") bits.push("[Image]");
    else if (p.type === "file" && p.file) {
      bits.push(`[File: ${p.file.filename || p.file.name || "attachment"}]`);
    }
  }
  return bits.join("\n").trim();
}

function mimeFromDataUrl(url) {
  const m = /^data:([^;,]+)/i.exec(url || "");
  return m ? m[1].toLowerCase() : "";
}

function imagePreviewable(url) {
  return /^data:image\/(png|jpeg|jpg|jpe|webp|gif|bmp)/i.test(url || "");
}

/**
 * Rebuild ChatInput state from a stored user message (for Edit).
 */
export function userContentToEditPayload(content) {
  if (typeof content === "string") {
    return { text: content, attachments: [] };
  }
  if (!Array.isArray(content)) {
    return { text: "", attachments: [] };
  }
  const attachments = [];
  const textParts = [];
  for (const p of content) {
    if (p.type === "text" && p.text) textParts.push(p.text);
    else if (p.type === "image_url" && p.image_url?.url) {
      const url = p.image_url.url;
      attachments.push({
        kind: "image",
        dataUrl: url,
        fileName: "Image",
        mime: mimeFromDataUrl(url) || "image/png",
        previewable: imagePreviewable(url),
      });
    } else if (p.type === "file" && p.file?.dataUrl) {
      attachments.push({
        kind: "document",
        dataUrl: p.file.dataUrl,
        fileName: p.file.filename || p.file.name || "Attachment",
        mime: p.file.mime || "",
        previewable: false,
      });
    }
  }
  return {
    text: textParts.join("\n").trim(),
    attachments,
  };
}
