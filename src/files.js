import multer from "multer";
import { id, fail, one } from "./core.js";
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 8,
    fieldSize: 4096,
    parts: 10,
  },
});
export async function storeFile(c, req) {
  const f = req.file;
  if (!f)
    fail(422, "FILE_REQUIRED", "A JPEG, PNG or PDF proof file is required");
  const b = f.buffer;
  let mime;
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    mime = "image/png";
  else if (b[0] === 255 && b[1] === 216 && b[2] === 255) mime = "image/jpeg";
  else if (b.subarray(0, 5).toString() === "%PDF-") mime = "application/pdf";
  else
    fail(
      422,
      "INVALID_FILE",
      "Only PNG, JPEG and PDF proof files are accepted",
    );
  const fileId = id();
  await c.query(
    "INSERT INTO files(id,user_id,mime_type,content) VALUES($1,$2,$3,$4)",
    [fileId, req.user.id, mime, b],
  );
  return fileId;
}
export function fileRoutes(router, db, auth) {
  router.get("/files/:id", auth, async (req, res) => {
    const f = await one(
      db,
      "SELECT * FROM files WHERE id=$1 AND (user_id=$2 OR $3::boolean)",
      [req.params.id, req.user.id, req.user.role === "admin"],
    );
    res.set("Content-Type", f.mime_type);
    res.set(
      "Content-Disposition",
      `attachment; filename="proof-${f.id}.${f.mime_type === "application/pdf" ? "pdf" : f.mime_type === "image/png" ? "png" : "jpg"}"`,
    );
    res.send(f.content);
  });
}
