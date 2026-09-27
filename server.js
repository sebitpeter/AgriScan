const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const cloudinary = require("cloudinary").v2;

dotenv.config();

const app = express();
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "development_secret_change_me";

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const publicPath = path.join(__dirname, "public");
const uploadsPath = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use(express.static(publicPath));
app.use("/uploads", express.static(uploadsPath));

const cloudinaryEnabled =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsPath),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const safeName =
      Date.now() + "-" + Math.random().toString(36).slice(2) + ext;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  }
});

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication required." });
  }

  const token = header.split(" ")[1];

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "AgriScan API is running.",
    cloudinary: Boolean(cloudinaryEnabled)
  });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email and password are required."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters."
      });
    }

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      return res.status(409).json({ message: "Email is already registered." });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { name, email, passwordHash }
    });

    const token = createToken(user);

    res.status(201).json({
      message: "Account created successfully.",
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = createToken(user);

    res.json({
      message: "Login successful.",
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Login failed." });
  }
});

app.get("/api/auth/me", auth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, createdAt: true }
  });

  if (!user) return res.status(404).json({ message: "User not found." });

  res.json({ user });
});

app.post("/api/uploads", auth, upload.array("images", 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No images uploaded." });
    }

    const urls = [];

    for (const file of req.files) {
      if (cloudinaryEnabled) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: "agriscan"
        });

        urls.push(result.secure_url);
        fs.unlinkSync(file.path);
      } else {
        urls.push(`${req.protocol}://${req.get("host")}/uploads/${file.filename}`);
      }
    }

    res.json({ message: "Images uploaded.", urls });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Image upload failed." });
  }
});

app.post("/api/inspections", auth, async (req, res) => {
  try {
    const {
      title,
      category,
      cropOrEquipment,
      notes,
      status,
      inspectionDate,
      imageUrls
    } = req.body;

    if (!title || !category || !cropOrEquipment) {
      return res.status(400).json({
        message: "Title, category and crop/equipment are required."
      });
    }

    const validStatuses = ["PENDING", "CRITICAL", "RESOLVED"];
    const finalStatus = validStatuses.includes(status) ? status : "PENDING";

    const inspection = await prisma.inspection.create({
      data: {
        userId: req.user.id,
        title: String(title).trim(),
        category: String(category).trim(),
        cropOrEquipment: String(cropOrEquipment).trim(),
        notes: String(notes || "").trim(),
        status: finalStatus,
        inspectionDate: inspectionDate
          ? new Date(inspectionDate)
          : new Date(),
        images: {
          create: Array.isArray(imageUrls)
            ? imageUrls.map((url) => ({ imageUrl: String(url) }))
            : []
        }
      },
      include: { images: true }
    });

    res.status(201).json({ message: "Inspection saved.", inspection });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not save inspection." });
  }
});

app.get("/api/inspections", auth, async (req, res) => {
  try {
    const { category, status, date, from, to, search } = req.query;

    const where = { userId: req.user.id };

    if (category) where.category = String(category);
    if (status) where.status = String(status);

    if (date) {
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      where.inspectionDate = { gte: start, lt: end };
    } else if (from || to) {
      where.inspectionDate = {};
      if (from) where.inspectionDate.gte = new Date(`${from}T00:00:00`);
      if (to) where.inspectionDate.lt = new Date(`${to}T23:59:59.999`);
    }

    if (search) {
      const value = String(search);
      where.OR = [
        { title: { contains: value } },
        { notes: { contains: value } },
        { cropOrEquipment: { contains: value } }
      ];
    }

    const inspections = await prisma.inspection.findMany({
      where,
      include: { images: true },
      orderBy: { inspectionDate: "desc" }
    });

    res.json({ inspections });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not load inspections." });
  }
});

app.get("/api/inspections/:id", auth, async (req, res) => {
  const id = Number(req.params.id);

  const inspection = await prisma.inspection.findFirst({
    where: { id, userId: req.user.id },
    include: { images: true }
  });

  if (!inspection) {
    return res.status(404).json({ message: "Inspection not found." });
  }

  res.json({ inspection });
});

app.put("/api/inspections/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const existing = await prisma.inspection.findFirst({
      where: { id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ message: "Inspection not found." });
    }

    const data = {};

    for (const key of [
      "title",
      "category",
      "cropOrEquipment",
      "notes",
      "status"
    ]) {
      if (req.body[key] !== undefined) data[key] = String(req.body[key]);
    }

    if (req.body.inspectionDate) {
      data.inspectionDate = new Date(req.body.inspectionDate);
    }

    const inspection = await prisma.inspection.update({
      where: { id },
      data,
      include: { images: true }
    });

    res.json({ message: "Inspection updated.", inspection });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not update inspection." });
  }
});

app.delete("/api/inspections/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);

    const existing = await prisma.inspection.findFirst({
      where: { id, userId: req.user.id }
    });

    if (!existing) {
      return res.status(404).json({ message: "Inspection not found." });
    }

    await prisma.inspection.delete({ where: { id } });

    res.json({ message: "Inspection deleted." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Could not delete inspection." });
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ message: "API route not found." });
  }

  if (req.method !== "GET") {
    return next();
  }

  res.sendFile(path.join(publicPath, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ message: err.message || "Request failed." });
});

async function start() {
  try {
    await prisma.$connect();

    app.listen(PORT, () => {
      console.log(`AgriScan server running at http://localhost:${PORT}`);
      console.log(
        cloudinaryEnabled
          ? "Cloudinary uploads are ENABLED."
          : "Local image uploads are ENABLED."
      );
    });
  } catch (error) {
    console.error("Database connection failed:", error);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

start();