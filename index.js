import fs from 'fs/promises';
import path from 'path';

const INBOX_DIR = 'inbox/images';
const INBOX_FAILURES = 'inbox/failures';
const OUTBOX_SEEDREAM = 'outbox/seedream';
const OUTBOX_GEMINI = 'outbox/gemini';
const OUTBOX_ORIGINAL = 'outbox/original';

const DIRS = [INBOX_DIR, INBOX_FAILURES, OUTBOX_SEEDREAM, OUTBOX_GEMINI, OUTBOX_ORIGINAL];

async function setupDirectories() {
    for (const dir of DIRS) {
        await fs.mkdir(dir, { recursive: true });
        // Clean up README.md files if they exist
        try {
            await fs.unlink(path.join(dir, 'README.md'));
        } catch (e) {
            // Ignore if file doesn't exist
        }
    }
}

async function getApiKey() {
    try {
        const content = await fs.readFile('API_KEY.txt', 'utf-8');
        const match = content.match(/OPENROUTER_API_KEY=(.+)/);
        if (match && match[1]) {
            return match[1].trim();
        }
    } catch (e) {
        console.error('Could not read API_KEY.txt');
    }
    throw new Error('API Key missing or invalid in API_KEY.txt');
}

async function getPrompt() {
    try {
        return await fs.readFile('inbox/prompt.md', 'utf-8');
    } catch (e) {
        throw new Error('Could not read inbox/prompt.md');
    }
}

async function imageToBase64(filePath) {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${data.toString('base64')}`;
}

async function callOpenRouter(apiKey, model, prompt, base64Image) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000', // Required by OpenRouter
            'X-Title': 'Image Rinser'
        },
        body: JSON.stringify({
            model: model,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: base64Image } }
                    ]
                }
            ]
        })
    });

    if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
    }

    const json = await response.json();
    return json.choices[0].message.content;
}

function extractImageUrl(content) {
    if (!content) return null;
    // Check if it's raw base64 string directly
    if (content.startsWith('iVBORw0KGgo')) return `data:image/png;base64,${content}`;
    if (content.startsWith('/9j/')) return `data:image/jpeg;base64,${content}`;

    // OpenRouter image generation models often return markdown images or raw URLs
    const markdownMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+|data:image[^\s)]+)\)/);
    if (markdownMatch) return markdownMatch[1];
    
    const urlMatch = content.match(/(https?:\/\/[^\s]+|data:image[^\s]+)/);
    if (urlMatch) return urlMatch[1];

    return null;
}

async function downloadAndSaveImage(urlOrBase64, savePath) {
    if (urlOrBase64.startsWith('data:image')) {
        const base64Data = urlOrBase64.split(',')[1];
        await fs.writeFile(savePath, Buffer.from(base64Data, 'base64'));
        return;
    }

    const response = await fetch(urlOrBase64);
    if (!response.ok) throw new Error('Failed to download image from result URL');
    const buffer = await response.arrayBuffer();
    await fs.writeFile(savePath, Buffer.from(buffer));
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
        const content = await callOpenRouter(apiKey, 'bytedance-seed/seedream-4.5', promptText, base64Image);
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
        const content = await callOpenRouter(apiKey, 'google/gemini-3.1-flash-image-preview', promptText, base64Image);
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

async function main() {
    await setupDirectories();

    const apiKey = await getApiKey();
    const promptText = await getPrompt();

    const files = await fs.readdir(INBOX_DIR);
    const images = files.filter(f => !f.toLowerCase().endsWith('.md'));

    if (images.length === 0) {
        console.log('No images found in inbox/images');
        return;
    }

    console.log(`Found ${images.length} images to process.`);

    for (const image of images) {
        await processImage(image, apiKey, promptText);
    }

    console.log('\nAll images processed.');
}

main().catch(console.error);
