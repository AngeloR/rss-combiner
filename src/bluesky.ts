import 'dotenv/config';
import { AtpAgent, RichText } from "@atproto/api";
import { Feed } from 'feed';
import fs from 'fs/promises';
import path from "path";

type PostData = {
    postId: string;
    pubDate: Date;
    originalPoster: {
        displayName: string;
        handle: string;
        avatar: string;
        href: string;
    };
    quotedPoster?: {
        displayName: string;
        handle: string;
        avatar: string;
        href: string;
    };
    content: string;
    originalLink: string;
    repost: boolean;
    embed?: any
}

const agent = new AtpAgent({
    service: 'https://bsky.social',
});

async function parseText(text: string) {
    const rt = new RichText({ text });
    await rt.detectFacets(agent);

    return rt;
}

function flatten(key: string, obj: any) {
    const newObj = { ...obj };

    while (newObj[key] && newObj[key][key]) {
        newObj[key] = newObj[key][key];
    }

    return newObj;
}

async function parsePost(post: any) {
    let embed = null;
    if (post.embed) {
        embed = await parsePost(post.embed);
    }

    switch (post.$type) {
        case 'app.bsky.embed.external#view':
            embed = post.external;
            break;
        case 'app.bsky.embed.record#view':
            embed = await parsePost(post.record);
            break;
        case 'app.bsky.embed.record#viewRecord':
            embed = await parsePost(post.embeds[0]);
            break;
        case 'app.bsky.embed.images#view':
            embed = { images: post.images };
            break;
        case undefined:
            break;
        default:
            console.log(`Unsupported post type: ${post.$type}`);
            break;
    }

    let postText = null;
    if (post?.record?.text) {
        postText = await parseText(post.record.text);
    }

    let res: any = {};

    if (postText?.text) {
        res.content = postText.text;
    }

    if (embed) {
        res.embed = embed;
    }

    return res;

}

async function main() {
    const login = await agent.login({
        identifier: process.env.BLUESKY_IDENTIFIER,
        password: process.env.BLUESKY_PASSWORD,
    });

    const user = await agent.getProfile({
        actor: login.data.did,
    });

    const posts = await agent.getAuthorFeed({
        actor: user.data.did,
        limit: 50, // default
    });

    const parsedPosts = (await Promise.all(posts.data.feed.map(async data => {
        if (data.reply) {
            // we don't want replies to make it to the website
            return null;
        }

        let parsed = await parsePost(data.post);
        if (parsed.embed) {
            parsed = flatten('embed', parsed);
        }

        parsed.pubDate = new Date(data.post.indexedAt);
        parsed.postId = data.post.uri.split('/').pop();

        parsed.originalPoster = {
            displayName: user.data.displayName,
            handle: user.data.handle,
            avatar: user.data.avatar,
            href: `https://bsky.social/profile/${user.data.handle}`,
        };
        // if I wasn't the original poster, I want to include the 
        // original posters display name and link to their profile
        if (data.post.author.did !== user.data.did) {
            parsed.quotedPoster = {
                displayName: data.post.author.displayName,
                handle: data.post.author.handle,
                avatar: data.post.author.avatar,
                href: `https://bsky.social/profile/${data.post.author.handle}`,
            };
            parsed.repost = true;
        }
        else {
            parsed.repost = false;
        }

        parsed.originalLink = `https://bsky.app/profile/${parsed.originalPoster.handle}/post/${parsed.postId}`;

        return parsed;
    }))).filter(post => post !== null);

    // ok now that we have that list of posts, lets iterate over them and figure out which 
    // ones are new and which ones we've handled before

    console.log(parsedPosts);

    const feed = generateFeed(parsedPosts);

    await fs.writeFile(path.join(__dirname, '..', 'feed.rss'), feed);

    console.log(feed);
}

function generateFeed(posts: PostData[]) {
    const feed = new Feed({
        title: 'Xangelo\'s Bluesky Posts',
        description: 'Xangelo\'s Bluesky Posts',
        id: `https://bsky.social/profile/${process.env.BLUESKY_USERNAME}`,
        updated: posts[0].pubDate,
        copyright: 'I wrote this stuff, so just like.. don\'t steal it or anything.',
    });

    posts.forEach(post => {
        feed.addItem({
            title: post.content,
            id: post.originalLink,
            link: post.originalLink,
            content: renderPostHTML(post),
            date: post.pubDate,
            published: post.pubDate,
            author: [{
                name: post.originalPoster.displayName,
                link: post.originalPoster.href,
            }],
            contributor: post.quotedPoster ? [{
                name: post.quotedPoster?.displayName,
                link: post.quotedPoster?.href,
            }] : undefined,
        });
    });

    return feed.rss2();
}

// Helper to escape HTML special characters
function escapeHTML(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderPostHTML(post: PostData): string {
    const { content, embed, postId, originalPoster, repost, originalLink } = post;

    return `
      <article id="post-${postId}" class="post-entry${repost ? ' repost' : ''}">
        <header class="post-header ${repost ? 'repost' : ''}">
          <a href="${originalPoster.href}" class="poster-info">
            <img src="${originalPoster.avatar}" alt="${originalPoster.displayName}'s avatar" class="poster-avatar" />
            <div class="poster-name">
              <strong>${originalPoster.displayName}</strong>
              <span class="poster-handle">@${originalPoster.handle}</span>
            </div>
          </a>
        </header>
      
        <div class="post-content">
          <p>${escapeHTML(content)}</p>
        </div>
      
        ${embed ? `
        <a href="${embed.uri}" class="post-embed" target="_blank" rel="noopener noreferrer">
          <figure>
            <img src="${embed.thumb}" alt="${embed.title}" class="embed-thumb" />
            <figcaption>
              <h4>${embed.title}</h4>
              <p>${embed.description}</p>
            </figcaption>
          </figure>
        </a>` : ''}
      
        <footer class="post-footer">
          <a href="${originalLink}" class="post-link" target="_blank" rel="noopener noreferrer">View original</a>
        </footer>
      </article>
      `.trim();
}

main().catch(console.error);

