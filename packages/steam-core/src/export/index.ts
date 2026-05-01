import type { CollectionPlan, ExportFormat, ExportResult, GameRecord } from '../types.js';

export class ExportService {
  render(source: string, format: ExportFormat, items: GameRecord[] | CollectionPlan): ExportResult {
    const itemCount = Array.isArray(items) ? items.length : Object.keys(items).length;
    const content = format === 'json' ? `${JSON.stringify(items, null, 2)}\n` : renderMarkdown(source, items);

    return {
      format,
      content,
      metadata: {
        itemCount,
        source
      }
    };
  }
}

function renderMarkdown(source: string, items: GameRecord[] | CollectionPlan): string {
  if (Array.isArray(items)) {
    const lines = ['# Steam MCP Export', '', `Source: ${source}`, '', '| App ID | Name | Installed | Favorite | Hidden |', '| --- | --- | --- | --- | --- |'];
    for (const game of items) {
      lines.push(`| ${game.appId} | ${game.name} | ${game.installed ? 'yes' : 'no'} | ${game.favorite ? 'yes' : 'no'} | ${game.hidden ? 'yes' : 'no'} |`);
    }

    return `${lines.join('\n')}\n`;
  }

  return `# Steam MCP Export\n\nSource: ${source}\n\n\
${'```json'}\n${JSON.stringify(items, null, 2)}\n${'```'}\n`;
}
