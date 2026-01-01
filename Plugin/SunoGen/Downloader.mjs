#!/usr/bin/env node
import axios from "axios";
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fsp } from 'fs';

// Helper to get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function downloadAudio(url, title, taskId) {
    try {
        // Define the target directory relative to the project root (h:/VCP/VCPToolBox/file/music)
        // SunoGen.mjs is in Plugin/SunoGen/
        // So .. / .. / file / music
        const musicDir = path.resolve(__dirname, '..', '..', 'file', 'music');

        // Ensure the directory exists
        await fsp.mkdir(musicDir, { recursive: true });

        // Sanitize title to create a valid filename. Fallback to task_id if title is missing.
        const safeTitle = (title || `suno_song_${taskId}`).replace(/[^a-z0-9\u4e00-\u9fa5\-_.]/gi, '_').replace(/ /g, '_');
        const filename = `${safeTitle}.mp3`;
        const filepath = path.join(musicDir, filename);

        // Download the file using axios
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'arraybuffer'
        });

        // Save the file
        await fsp.writeFile(filepath, response.data);

        console.log(`[Downloader] Successfully downloaded: ${filepath}`);
    } catch (error) {
        console.error(`[Downloader] Failed to download audio file for task ${taskId}: ${error.message}`);
    }
}

// Get arguments from command line
const [url, title, taskId] = process.argv.slice(2);

if (!url || !taskId) {
    console.error("Usage: node Downloader.mjs <url> <title> <taskId>");
    process.exit(1);
}

downloadAudio(url, title, taskId);
