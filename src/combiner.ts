import toml from 'toml';
import Parser from 'rss-parser'
import { Feed } from 'feed';
import fs from 'fs';
import path from 'path';

const config = toml.parse(fs.readFileSync(path.join(__dirname, '..', 'config.toml'), 'utf8'));

async function main() {
    const combinedFeed = new Feed({
        title: config.combinedFeed.title,
        description: config.combinedFeed.description,
        link: config.combinedFeed.link,
        id: config.combinedFeed.id,
        copyright: config.combinedFeed.copyright,
    });

    const parser = new Parser();
    const feeds = await Promise.all(config.feeds.map(async (feedConfig) => {
        if (feedConfig.type === 'link') {
            const feed = await parser.parseURL(feedConfig.url);
            return feed;
        } else {
            const feed = await parser.parseString(fs.readFileSync(path.join(__dirname, '..', feedConfig.baseFilePath, feedConfig.filename), 'utf8'));
            return feed;
        }
    }));

    const feedItems = [];

    feeds.forEach((feed, index) => {
        feed.items.forEach((item) => {
            feedItems.push({
                title: item.title ?? config.feeds[index].title,
                id: item.link,
                link: item.link,
                published: new Date(item.pubDate),
                content: item.content || item['content:encoded'],
                author: [{
                    name: 'Angelo R.',
                    link: config.feeds[index].profile,
                }],
                source: config.feeds[index].title,
            });
        });
    });

    // sort by date, newest first   
    feedItems.sort((a, b) => {
        return b.published.getTime() - a.published.getTime();
    })

    feedItems.forEach((item) => {
        combinedFeed.addItem(item);
    });

    fs.writeFileSync('combined.xml', combinedFeed.rss2());
}

main().catch(console.error);

