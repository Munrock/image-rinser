import fs from "fs/promises";
import path from "path";

const INBOX_DIR = "inbox/images";
const INBOX_PROMPTS = "inbox/prompts";
const INBOX_FAILURES = "inbox/failures";
const OUTBOX_SEEDREAM = "outbox/seedream";
const OUTBOX_GEMINI = "outbox/gemini";
const OUTBOX_ORIGINAL = "outbox/original";

const DIRS = [
  INBOX_DIR,
  INBOX_PROMPTS,
  INBOX_FAILURES,
  OUTBOX_SEEDREAM,
  OUTBOX_GEMINI,
  OUTBOX_ORIGINAL,
];

async function setupDirectories() {
  for (const dir of DIRS) {
    await fs.mkdir(dir, { recursive: true });
    // Clean up README.md files if they exist
    try {
      await fs.unlink(path.join(dir, "README.md"));
    } catch (e) {
      // Ignore if file doesn't exist
    }
  }
}

async function getApiKey() {
  try {
    const content = await fs.readFile("API_KEY.txt", "utf-8");
    const match = content.match(/OPENROUTER_API_KEY=(.+)/);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch (e) {
    console.error("Could not read API_KEY.txt");
  }
  throw new Error("API Key missing or invalid in API_KEY.txt");
}

async function getPrompt() {
  try {
    return await fs.readFile("inbox/prompt.md", "utf-8");
  } catch (e) {
    throw new Error("Could not read inbox/prompt.md");
  }
}

async function imageToBase64(filePath) {
  const data = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `data:image/${mime};base64,${data.toString("base64")}`;
}

async function callOpenRouter(
  apiKey,
  model,
  prompt,
  base64Image,
  modalities = ["image", "text"],
) {
  const content = [{ type: "text", text: prompt }];
  if (base64Image) {
    content.push({ type: "image_url", image_url: { url: base64Image } });
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000", // Required by OpenRouter
        "X-Title": "Image Rinser",
      },
      body: JSON.stringify({
        model: model,
        modalities: modalities,
        messages: [
          {
            role: "user",
            content: content,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    let errorText = await response.text();
    throw new Error(`API returned ${response.status}: ${errorText}`);
  }

  const json = await response.json();
  return json.choices[0].message;
}

function extractImageUrl(message) {
  if (!message) return null;

  // Check OpenRouter's official standard images array
  if (message.images && message.images.length > 0) {
    if (message.images[0].image_url && message.images[0].image_url.url) {
      return message.images[0].image_url.url;
    }
  }

  const content = message.content;
  if (!content) return null;

  // Check if it's raw base64 string directly in content
  if (content.startsWith("iVBORw0KGgo"))
    return `data:image/png;base64,${content}`;
  if (content.startsWith("/9j/")) return `data:image/jpeg;base64,${content}`;

  // OpenRouter image generation models sometimes return markdown images or raw URLs
  const markdownMatch = content.match(
    /!\[.*?\]\((https?:\/\/[^\s)]+|data:image[^\s)]+)\)/,
  );
  if (markdownMatch) return markdownMatch[1];

  const urlMatch = content.match(/(https?:\/\/[^\s]+|data:image[^\s]+)/);
  if (urlMatch) return urlMatch[1];

  return null;
}

async function downloadAndSaveImage(urlOrBase64, savePath) {
  let buffer;
  if (urlOrBase64.startsWith("data:image")) {
    const base64Data = urlOrBase64.split(",")[1];
    buffer = Buffer.from(base64Data, "base64");
  } else {
    const response = await fetch(urlOrBase64);
    if (!response.ok)
      throw new Error("Failed to download image from result URL");
    buffer = Buffer.from(await response.arrayBuffer());
  }

  // Detect image type using magic bytes
  let ext = path.extname(savePath);
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    ext = ".png";
  } else if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    ext = ".jpg";
  }

  // Construct the new path with the correct format extension
  const parsedPath = path.parse(savePath);
  const finalPath = path.format({ ...parsedPath, base: undefined, ext });

  await fs.writeFile(finalPath, buffer);
}

async function processImage(file, apiKey, promptText) {
  const filePath = path.join(INBOX_DIR, file);
  console.log(`\nProcessing: ${file}`);

  const base64Image = await imageToBase64(filePath);

  let seedreamSuccess = false;
  let geminiSuccess = false;

  // Process Seedream
  try {
    console.log(`  - Calling Seedream...`);
    const content = await callOpenRouter(
      apiKey,
      "bytedance-seed/seedream-4.5",
      promptText,
      base64Image,
      ["image"],
    );
    const imageUrl = extractImageUrl(content);
    if (imageUrl) {
      await downloadAndSaveImage(imageUrl, path.join(OUTBOX_SEEDREAM, file));
      seedreamSuccess = true;
      console.log(`  - Seedream success`);
    } else {
      console.log(`  - Seedream returned non-image response`);
    }
  } catch (e) {
    console.error(`  - Seedream failed: ${e.message}`);
  }

  // Process Gemini
  try {
    console.log(`  - Calling Gemini...`);
    const content = await callOpenRouter(
      apiKey,
      "google/gemini-3-pro-image-preview",
      promptText,
      base64Image,
      ["image", "text"],
    );
    const imageUrl = extractImageUrl(content);
    if (imageUrl) {
      await downloadAndSaveImage(imageUrl, path.join(OUTBOX_GEMINI, file));
      geminiSuccess = true;
      console.log(`  - Gemini success`);
    } else {
      console.log(`  - Gemini returned non-image response`);
    }
  } catch (e) {
    console.error(`  - Gemini failed: ${e.message}`);
  }

  // Move original
  if (seedreamSuccess || geminiSuccess) {
    await fs.rename(filePath, path.join(OUTBOX_ORIGINAL, file));
    console.log(`  -> Moved to outbox/original`);
  } else {
    await fs.rename(filePath, path.join(INBOX_FAILURES, file));
    console.log(`  -> Both failed, moved to inbox/failures`);
  }
}

async function processTextPrompt(file, apiKey) {
  const filePath = path.join(INBOX_PROMPTS, file);
  console.log(`\nProcessing text prompt: ${file}`);

  let promptText;
  try {
    promptText = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    console.error(`  - Failed to read text prompt: ${e.message}`);
    return;
  }

  let seedreamSuccess = false;
  let geminiSuccess = false;

  const baseFileName = path.parse(file).name;
  // We don't have an extension for the generated image yet, `downloadAndSaveImage` will figure it out
  // and append .png/.jpg. We will save it with .png default, and it will rewrite extension.
  const tempSaveName = baseFileName + ".png";

  // Process Seedream
  try {
    console.log(`  - Calling Seedream...`);
    const content = await callOpenRouter(
      apiKey,
      "bytedance-seed/seedream-4.5",
      promptText,
      null,
      ["image"],
    );
    const imageUrl = extractImageUrl(content);
    if (imageUrl) {
      await downloadAndSaveImage(
        imageUrl,
        path.join(OUTBOX_SEEDREAM, tempSaveName),
      );
      seedreamSuccess = true;
      console.log(`  - Seedream success`);
    } else {
      console.log(`  - Seedream returned non-image response`);
    }
  } catch (e) {
    console.error(`  - Seedream failed: ${e.message}`);
  }

  // Process Gemini
  try {
    console.log(`  - Calling Gemini...`);
    const content = await callOpenRouter(
      apiKey,
      "google/gemini-3-pro-image-preview",
      promptText,
      null,
      ["image", "text"],
    );
    const imageUrl = extractImageUrl(content);
    if (imageUrl) {
      await downloadAndSaveImage(
        imageUrl,
        path.join(OUTBOX_GEMINI, tempSaveName),
      );
      geminiSuccess = true;
      console.log(`  - Gemini success`);
    } else {
      console.log(`  - Gemini returned non-image response`);
    }
  } catch (e) {
    console.error(`  - Gemini failed: ${e.message}`);
  }

  // Move original
  if (seedreamSuccess || geminiSuccess) {
    await fs.rename(filePath, path.join(OUTBOX_ORIGINAL, file));
    console.log(`  -> Moved to outbox/original`);
  } else {
    await fs.rename(filePath, path.join(INBOX_FAILURES, file));
    console.log(`  -> Both failed, moved to inbox/failures`);
  }
}

async function main() {
  await setupDirectories();

  const apiKey = await getApiKey();
  let promptText = "";
  try {
    promptText = await getPrompt();
  } catch (e) {
    console.log(
      "No inbox/prompt.md found, image to image generation won't have a base prompt.",
    );
  }

  let files = [];
  try {
    files = await fs.readdir(INBOX_DIR);
  } catch (e) {
    // Ignore if dir doesn't exist
  }
  const images = files.filter((f) => !f.toLowerCase().endsWith(".md"));

  if (images.length > 0 && promptText) {
    console.log(`Found ${images.length} images to process.`);
    for (const image of images) {
      await processImage(image, apiKey, promptText);
    }
  } else if (images.length > 0 && !promptText) {
    console.log(
      `Found ${images.length} images to process, but no inbox/prompt.md provided.`,
    );
  }

  let prompts = [];
  try {
    prompts = await fs.readdir(INBOX_PROMPTS);
  } catch (e) {
    // Ignore if dir doesn't exist
  }

  const textPrompts = prompts.filter((f) => f.toLowerCase().endsWith(".txt"));

  if (textPrompts.length > 0) {
    console.log(`\nFound ${textPrompts.length} text prompts to process.`);
    for (const textPrompt of textPrompts) {
      await processTextPrompt(textPrompt, apiKey);
    }
  }

  if (images.length === 0 && textPrompts.length === 0) {
    console.log("No images or text prompts found to process.");
    return;
  }

  console.log("\nAll items processed.");
}

main().catch(console.error);
