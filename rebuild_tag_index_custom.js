// rebuild_tag_index_custom.js
// 功能：1. 清理数据库中已存在的黑名单标签  2. 重新构建全局 Tag 向量索引
const fs = require('fs').promises;
const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config();

// 1. 加载配置
const config = {
    storePath: path.join(__dirname, 'VectorStore'),
    dbName: 'knowledge_base.sqlite',
    dimension: parseInt(process.env.VECTORDB_DIMENSION) || 3072,
    // 从环境变量获取黑名单
    tagBlacklist: (process.env.TAG_BLACKLIST || '').split(',').map(t => t.trim()).filter(Boolean)
};

async function main() {
    console.log('--- 🏷️ 专门重建 Tag 索引 (含黑名单清理) ---');
    
    const dbPath = path.join(config.storePath, config.dbName);
    const tagIdxPath = path.join(config.storePath, 'index_global_tags.usearch');
    
    if (!require('fs').existsSync(dbPath)) {
        console.error('❌ 数据库文件不存在，请检查 VectorStore 目录');
        return;
    }

    const db = new Database(dbPath);
    
    try {
        // 步骤 1: 从数据库中物理删除黑名单标签
        if (config.tagBlacklist.length > 0) {
            console.log(`[Step 1/4] 正在从数据库清理 ${config.tagBlacklist.length} 个黑名单标签...`);
            const placeholders = config.tagBlacklist.map(() => '?').join(',');
            const info = db.prepare(`DELETE FROM tags WHERE name IN (${placeholders})`).run(...config.tagBlacklist);
            console.log(`✅ 已从数据库抹除 ${info.changes} 条存量黑名单记录。`);
        } else {
            console.log('[Step 1/4] 未检测到黑名单配置，跳过清理。');
        }

        // 步骤 2: 存量 Tag 句号净化与合并 (零 API 成本)
        console.log('[Step 2/4] 正在执行存量 Tag 句号净化...');
        const dottedTags = db.prepare("SELECT id, name, vector FROM tags WHERE name LIKE '%.%' OR name LIKE '%。%'").all();
        let mergeCount = 0;
        let renameCount = 0;

        const transaction = db.transaction(() => {
            for (const tag of dottedTags) {
                const cleanName = tag.name.replace(/[。.]+$/g, '').trim();
                if (!cleanName || cleanName === tag.name) continue;

                const existing = db.prepare("SELECT id FROM tags WHERE name = ?").get(cleanName);
                if (existing) {
                    // 合并：将旧 Tag 的文件关联转移到新 Tag
                    db.prepare("UPDATE OR IGNORE file_tags SET tag_id = ? WHERE tag_id = ?").run(existing.id, tag.id);
                    // 删除旧的带句号 Tag
                    db.prepare("DELETE FROM tags WHERE id = ?").run(tag.id);
                    mergeCount++;
                } else {
                    // 重命名：直接修改名称，保留原向量
                    db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(cleanName, tag.id);
                    renameCount++;
                }
            }
        });
        transaction();
        console.log(`✅ 净化完成：合并 ${mergeCount} 个重复项，重命名 ${renameCount} 个标签。`);

        // 步骤 3: 删除旧的索引文件
        console.log('[Step 2/3] 正在删除旧的 Tag 索引文件...');
        try {
            await fs.unlink(tagIdxPath);
            console.log('✅ 旧索引文件已移除。');
        } catch (e) {
            console.log('ℹ️ 未发现旧索引文件，准备创建新索引。');
        }

        // 步骤 4: 调用 Rust 引擎重建索引
        console.log('[Step 4/4] 正在通过 Rust 引擎重建索引...');
        const { VexusIndex } = require('./rust-vexus-lite');
        const tagIdx = new VexusIndex(config.dimension, 50000);
        
        // 核心：从清理后的数据库重新加载
        const count = await tagIdx.recoverFromSqlite(dbPath, 'tags', null);
        tagIdx.save(tagIdxPath);
        
        console.log(`\n✨ 重建成功！共索引 ${count} 个合法标签。`);
        console.log(`文件位置: ${tagIdxPath}`);

    } catch (error) {
        console.error('❌ 重建失败:', error);
    } finally {
        db.close();
    }
}

main();