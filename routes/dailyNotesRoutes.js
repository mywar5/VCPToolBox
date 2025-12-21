const express = require('express');
const fs = require('fs').promises;
const path = require('path');

/**
 * 日记本管理模块
 * @param {string} dailyNoteRootPath 日记本根目录
 * @param {boolean} DEBUG_MODE 是否开启调试模式
 * @returns {express.Router}
 */
module.exports = function(dailyNoteRootPath, DEBUG_MODE) {
    const router = express.Router();

    // GET all folder names in dailynote directory
    router.get('/folders', async (req, res) => {
        try {
            await fs.access(dailyNoteRootPath); 
            const entries = await fs.readdir(dailyNoteRootPath, { withFileTypes: true });
            const folders = entries
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name);
            res.json({ folders });
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn('[DailyNotes API] /folders - dailynote directory not found.');
                res.json({ folders: [] }); 
            } else {
                console.error('[DailyNotes API] Error listing daily note folders:', error);
                res.status(500).json({ error: 'Failed to list daily note folders', details: error.message });
            }
        }
    });

    // GET all note files in a specific folder with last modified time
    router.get('/folder/:folderName', async (req, res) => {
        const folderName = req.params.folderName;
        const specificFolderParentPath = path.join(dailyNoteRootPath, folderName);

        try {
            await fs.access(specificFolderParentPath); 
            const files = await fs.readdir(specificFolderParentPath);
            const noteFiles = files.filter(file => file.toLowerCase().endsWith('.txt') || file.toLowerCase().endsWith('.md'));
            const PREVIEW_LENGTH = 100;

            const notes = await Promise.all(noteFiles.map(async (file) => {
                const filePath = path.join(specificFolderParentPath, file);
                const stats = await fs.stat(filePath);
                let preview = '';
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    preview = content.substring(0, PREVIEW_LENGTH).replace(/\n/g, ' ') + (content.length > PREVIEW_LENGTH ? '...' : '');
                } catch (readError) {
                    console.warn(`[DailyNotes API] Error reading file for preview ${filePath}: ${readError.message}`);
                    preview = '[无法加载预览]';
                }
                return {
                    name: file,
                    lastModified: stats.mtime.toISOString(),
                    preview: preview
                };
            }));

            // Sort by lastModified time, newest first
            notes.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
            res.json({ notes });
 
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`[DailyNotes API] /folder/${folderName} - Folder not found.`);
                res.status(404).json({ error: `Folder '${folderName}' not found.` });
            } else {
                console.error(`[DailyNotes API] Error listing notes in folder ${folderName}:`, error);
                res.status(500).json({ error: `Failed to list notes in folder ${folderName}`, details: error.message });
            }
        }
    });

    // New API endpoint for searching notes with full content
    router.get('/search', async (req, res) => {
        const { term, folder } = req.query; 

        if (!term || typeof term !== 'string' || term.trim() === '') {
            return res.status(400).json({ error: 'Search term is required.' });
        }

        // 支持多关键字搜索（空格隔开）
        const searchTerms = term.trim().toLowerCase().split(/\s+/).filter(t => t !== '');
        const PREVIEW_LENGTH = 100;
        let foldersToSearch = [];
        const matchedNotes = [];

        try {
            if (folder && typeof folder === 'string' && folder.trim() !== '') {
                const specificFolderPath = path.join(dailyNoteRootPath, folder);
                try {
                    await fs.access(specificFolderPath);
                    if ((await fs.stat(specificFolderPath)).isDirectory()) {
                        foldersToSearch.push({ name: folder, path: specificFolderPath });
                    } else {
                        console.warn(`[DailyNotes API Search] Specified path '${folder}' is not a directory.`);
                        return res.status(404).json({ error: `Specified path '${folder}' is not a directory.`});
                    }
                } catch (e) {
                    console.warn(`[DailyNotes API Search] Specified folder '${folder}' not found during access check.`);
                    return res.status(404).json({ error: `Specified folder '${folder}' not found.` });
                }
            } else {
                await fs.access(dailyNoteRootPath);
                const entries = await fs.readdir(dailyNoteRootPath, { withFileTypes: true });
                entries.filter(entry => entry.isDirectory()).forEach(dir => {
                    foldersToSearch.push({ name: dir.name, path: path.join(dailyNoteRootPath, dir.name) });
                });
                if (foldersToSearch.length === 0) {
                     console.log('[DailyNotes API Search] No folders found in dailynote directory for global search.');
                     return res.json({ notes: [] });
                }
            }

            for (const dir of foldersToSearch) {
                const files = await fs.readdir(dir.path);
                const noteFiles = files.filter(file => file.toLowerCase().endsWith('.txt') || file.toLowerCase().endsWith('.md'));

                for (const fileName of noteFiles) {
                    const filePath = path.join(dir.path, fileName);
                    try {
                        const content = await fs.readFile(filePath, 'utf-8');
                        const lowerContent = content.toLowerCase();
                        
                        // 检查是否包含所有关键字 (AND 逻辑)
                        const isMatch = searchTerms.every(t => lowerContent.includes(t));
                        
                        if (isMatch) {
                            const stats = await fs.stat(filePath);
                            let preview = content.substring(0, PREVIEW_LENGTH).replace(/\n/g, ' ') + (content.length > PREVIEW_LENGTH ? '...' : '');
                            matchedNotes.push({
                                name: fileName,
                                folderName: dir.name,
                                lastModified: stats.mtime.toISOString(),
                                preview: preview
                            });
                        }
                    } catch (readError) {
                        console.warn(`[DailyNotes API Search] Error reading file ${filePath} for search: ${readError.message}`);
                    }
                }
            }

            // Sort by lastModified time, newest first
            matchedNotes.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
 
            res.json({ notes: matchedNotes });

        } catch (error) {
            if (error.code === 'ENOENT' && error.path && error.path.includes('dailynote')) {
                console.warn('[DailyNotes API Search] dailynote directory not found.');
                return res.json({ notes: [] }); 
            }
            console.error('[DailyNotes API Search] Error during daily note search:', error);
            res.status(500).json({ error: 'Failed to search daily notes', details: error.message });
        }
    });

    // GET content of a specific note file
    router.get('/note/:folderName/:fileName', async (req, res) => {
        const { folderName, fileName } = req.params;
        const filePath = path.join(dailyNoteRootPath, folderName, fileName);

        try {
            await fs.access(filePath); 
            const content = await fs.readFile(filePath, 'utf-8');
            res.json({ content });
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`[DailyNotes API] /note/${folderName}/${fileName} - File not found.`);
                res.status(404).json({ error: `Note file '${fileName}' in folder '${folderName}' not found.` });
            } else {
                console.error(`[DailyNotes API] Error reading note file ${folderName}/${fileName}:`, error);
                res.status(500).json({ error: `Failed to read note file ${folderName}/${fileName}`, details: error.message });
            }
        }
    });

    // POST to save/update content of a specific note file
    router.post('/note/:folderName/:fileName', async (req, res) => {
        const { folderName, fileName } = req.params;
        const { content } = req.body;

        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'Invalid request body. Expected { content: string }.' });
        }

        const targetFolderPath = path.join(dailyNoteRootPath, folderName); 
        const filePath = path.join(targetFolderPath, fileName);

        try {
            await fs.mkdir(targetFolderPath, { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');
            res.json({ message: `Note '${fileName}' in folder '${folderName}' saved successfully.` });
        } catch (error) {
            console.error(`[DailyNotes API] Error saving note file ${folderName}/${fileName}:`, error);
            res.status(500).json({ error: `Failed to save note file ${folderName}/${fileName}`, details: error.message });
        }
    });

    // POST to move one or more notes to a different folder
    router.post('/move', async (req, res) => {
        const { sourceNotes, targetFolder } = req.body;

        if (!Array.isArray(sourceNotes) || sourceNotes.some(n => !n.folder || !n.file) || typeof targetFolder !== 'string') {
            return res.status(400).json({ error: 'Invalid request body. Expected { sourceNotes: [{folder, file}], targetFolder: string }.' });
        }

        const results = {
            moved: [],
            errors: []
        };

        const targetFolderPath = path.join(dailyNoteRootPath, targetFolder);

        try {
            await fs.mkdir(targetFolderPath, { recursive: true });
        } catch (mkdirError) {
            console.error(`[DailyNotes API] Error creating target folder ${targetFolder} for move:`, mkdirError);
            return res.status(500).json({ error: `Failed to create target folder '${targetFolder}'`, details: mkdirError.message });
        }

        for (const note of sourceNotes) {
            const sourceFilePath = path.join(dailyNoteRootPath, note.folder, note.file);
            const destinationFilePath = path.join(targetFolderPath, note.file); 

            try {
                await fs.access(sourceFilePath);
                try {
                    await fs.access(destinationFilePath);
                    results.errors.push({
                        note: `${note.folder}/${note.file}`,
                        error: `File already exists at destination '${targetFolder}/${note.file}'. Move aborted for this file.`
                    });
                    continue; 
                } catch (destAccessError) {
                    // Destination file does not exist, proceed with move
                }
                
                await fs.rename(sourceFilePath, destinationFilePath);
                results.moved.push(`${note.folder}/${note.file} to ${targetFolder}/${note.file}`);
            } catch (error) {
                if (error.code === 'ENOENT' && error.path === sourceFilePath) {
                     results.errors.push({ note: `${note.folder}/${note.file}`, error: 'Source file not found.' });
                } else {
                    console.error(`[DailyNotes API] Error moving note ${note.folder}/${note.file} to ${targetFolder}:`, error);
                    results.errors.push({ note: `${note.folder}/${note.file}`, error: error.message });
                }
            }
        }

        const message = `Moved ${results.moved.length} note(s). ${results.errors.length > 0 ? `Encountered ${results.errors.length} error(s).` : ''}`;
        res.json({ message, moved: results.moved, errors: results.errors });
    });

    // POST to delete multiple notes
    router.post('/delete-batch', async (req, res) => {
        if (DEBUG_MODE) console.log('[DailyNotes API] POST /delete-batch route hit!');
        const { notesToDelete } = req.body; 

        if (!Array.isArray(notesToDelete) || notesToDelete.some(n => !n.folder || !n.file)) {
            return res.status(400).json({ error: 'Invalid request body. Expected { notesToDelete: [{folder, file}] }.' });
        }

        const results = {
            deleted: [],
            errors: []
        };

        for (const note of notesToDelete) {
            const filePath = path.join(dailyNoteRootPath, note.folder, note.file);
            try {
                await fs.access(filePath); 
                await fs.unlink(filePath); 
                results.deleted.push(`${note.folder}/${note.file}`);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    results.errors.push({ note: `${note.folder}/${note.file}`, error: 'File not found.' });
                } else {
                    console.error(`[DailyNotes API] Error deleting note ${note.folder}/${note.file}:`, error);
                    results.errors.push({ note: `${note.folder}/${note.file}`, error: error.message });
                }
            }
        }

        const message = `Deleted ${results.deleted.length} note(s). ${results.errors.length > 0 ? `Encountered ${results.errors.length} error(s).` : ''}`;
        res.json({ message, deleted: results.deleted, errors: results.errors });
    });

    // POST to delete an EMPTY folder
    router.post('/folder/delete', async (req, res) => {
        const { folderName } = req.body;

        if (!folderName || typeof folderName !== 'string' || folderName.trim() === '') {
            return res.status(400).json({ error: 'Invalid request body. Expected { folderName: string }.' });
        }

        const targetFolderPath = path.join(dailyNoteRootPath, folderName);

        try {
            // 安全检查：确保路径合法且在日记本根目录内
            const resolvedPath = path.resolve(targetFolderPath);
            const resolvedRoot = path.resolve(dailyNoteRootPath);
            if (!resolvedPath.startsWith(resolvedRoot) || resolvedPath === resolvedRoot) {
                return res.status(403).json({ error: 'Forbidden: Cannot delete the root directory or paths outside of daily notes.' });
            }

            // 检查文件夹是否存在
            await fs.access(targetFolderPath);
            
            // 读取文件夹内容，检查是否为空
            const files = await fs.readdir(targetFolderPath);
            if (files.length > 0) {
                return res.status(400).json({
                    error: `Folder '${folderName}' is not empty.`,
                    message: '为了安全起见，非空文件夹禁止删除。请先删除或移动其中的所有内容。'
                });
            }
            
            // 执行删除空文件夹的操作
            await fs.rmdir(targetFolderPath);
            
            res.json({ message: `Empty folder '${folderName}' has been deleted successfully.` });
        } catch (error) {
            if (error.code === 'ENOENT') {
                res.status(404).json({ error: `Folder '${folderName}' not found.` });
            } else {
                console.error(`[DailyNotes API] Error deleting folder ${folderName}:`, error);
                res.status(500).json({ error: `Failed to delete folder ${folderName}`, details: error.message });
            }
        }
    });

    return router;
};