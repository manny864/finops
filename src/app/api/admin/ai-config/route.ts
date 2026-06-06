import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';

export async function GET() {
    try {
        const [rows] = await pool.query<RowDataPacket[]>('SELECT setting_key, setting_value FROM GlobalSettings WHERE setting_key IN ("ai_provider", "ai_api_key")');
        const config: Record<string, string> = {};
        for (const row of rows) {
            config[row.setting_key] = row.setting_value;
        }
        return NextResponse.json({
            provider: config['ai_provider'] || 'openai',
            apiKey: config['ai_api_key'] ? '********' : '' // Mask key for UI
        });
    } catch (error) {
        console.error("Error fetching AI config:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const { provider, apiKey } = await req.json();

        if (!provider) {
            return NextResponse.json({ error: "Provider is required" }, { status: 400 });
        }

        const queries = [];
        queries.push(pool.query('INSERT INTO GlobalSettings (setting_key, setting_value) VALUES ("ai_provider", ?) ON DUPLICATE KEY UPDATE setting_value = ?', [provider, provider]));
        
        if (apiKey && apiKey !== '********') {
            queries.push(pool.query('INSERT INTO GlobalSettings (setting_key, setting_value) VALUES ("ai_api_key", ?) ON DUPLICATE KEY UPDATE setting_value = ?', [apiKey, apiKey]));
        }

        await Promise.all(queries);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error saving AI config:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
