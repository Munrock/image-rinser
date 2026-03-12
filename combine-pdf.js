import fs from 'fs';
import path from 'path';
import { PDFDocument, PageSizes } from 'pdf-lib';

async function main() {
    const geminiDir = path.join('outbox', 'gemini');
    const seedreamDir = path.join('outbox', 'seedream');

    const geminiFiles = fs.existsSync(geminiDir) ? fs.readdirSync(geminiDir).filter(f => !f.startsWith('.')) : [];
    const seedreamFiles = fs.existsSync(seedreamDir) ? fs.readdirSync(seedreamDir).filter(f => !f.startsWith('.')) : [];

    const duplicateNames = geminiFiles.filter(item => seedreamFiles.includes(item));

    if (duplicateNames.length > 0) {
        console.error('Error: Duplicate files found in both folders. Please manually resolve these (delete one of them):');
        duplicateNames.forEach(name => console.error(` - ${name}`));
        process.exit(1);
    }

    const allFiles = [
        ...geminiFiles.map(f => ({ name: f, source: path.join(geminiDir, f) })),
        ...seedreamFiles.map(f => ({ name: f, source: path.join(seedreamDir, f) }))
    ];

    allFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    if (allFiles.length === 0) {
        console.log('No images found in outbox/gemini or outbox/seedream. Exiting.');
        return;
    }

    const pdfDoc = await PDFDocument.create();

    for (const fileObj of allFiles) {
        console.log(`Processing: ${fileObj.name} from ${path.dirname(fileObj.source)}`);
        
        const imageBytes = fs.readFileSync(fileObj.source);
        let image;
        try {
            if (fileObj.name.toLowerCase().endsWith('.png')) {
                image = await pdfDoc.embedPng(imageBytes);
            } else if (fileObj.name.toLowerCase().match(/\.(jpg|jpeg)$/)) {
                image = await pdfDoc.embedJpg(imageBytes);
            } else {
                console.warn(`Skipping unsupported file format: ${fileObj.name}`);
                continue;
            }
        } catch (err) {
            console.error(`Failed to embed image ${fileObj.name}: ${err.message}`);
            continue;
        }

        const page = pdfDoc.addPage(PageSizes.A4);
        const { width, height } = page.getSize();

        page.drawImage(image, {
            x: 0,
            y: 0,
            width: width,
            height: height
        });
    }

    const pdfBytes = await pdfDoc.save();
    const outputPath = path.join('outbox', 'combined_output.pdf');
    fs.writeFileSync(outputPath, pdfBytes);
    
    console.log(`Successfully created PDF with ${allFiles.length} pages at ${outputPath}`);
}

main().catch(console.error);