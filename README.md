# Image Rinser

Image Rinser is a tool that batch processes images through OpenRouter's AI models (Gemini & Seedream) based on a custom text prompt, and generates a combined PDF containing the generated visual outputs.

## Setup

1. **Install Dependencies**
   Run the following command to install the required Node.js packages:

   ```bash
   npm install
   ```

2. **API Key Setup**
   Copy the example API key file or create a new one:
   ```bash
   cp API_KEY.txt.example API_KEY.txt
   ```
   Open `API_KEY.txt` and replace the placeholder with your actual OpenRouter API Key:
   `OPENROUTER_API_KEY=your_actual_key_here`

## Usage

### 1. Prepare Your Inputs

- **Images:** Place all the images you want to process into the `inbox/images/` directory.
- **Prompt:** Open `inbox/prompt.md` and write the prompt/instructions you want the AI to follow for each image.

### 2. Process the Images

Run the main script to start processing the images through the OpenRouter API:

```bash
node index.js
```

As the script runs:

- Successful generations are saved to `outbox/gemini/` and `outbox/seedream/`.
- Original processed images are moved to `outbox/original/`.
- Any images that fail to process will be moved to `inbox/failures/`.

### 3. Generate the Combined PDF

Once the image processing is complete, you can combine all the generated images into a single A4 PDF file:

```bash
node combine-pdf.js
```

Before running the command, you need to choose which of the two versions to use: this is done by deleting the version you don't want (or moving it to a different directory).

The final PDF will be saved to `outbox/combined_output.pdf`.
