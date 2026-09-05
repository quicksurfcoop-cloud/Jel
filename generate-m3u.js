const fs = require('fs');

if (!fs.existsSync('channels.json')) {
  console.error('Error: channels.json not found! Run build-schedule.js first.');
  process.exit(1);
}

const schedule = JSON.parse(fs.readFileSync('channels.json', 'utf8'));
const JELLYFIN_URL = process.env.JELLYFIN_URL || 'https://spread.thepebbles.tech';
const apiKey = schedule.apiKey || '';

const nowSeconds = Math.floor(Date.now() / 1000);
const FIXED_EPOCH_SECONDS = 1767225600; 

let masterM3u = '#EXTM3U\n\n';

for (const [channelId, channel] of Object.entries(schedule.channels)) {
  // Calculate currently active item based on schedule loop offset
  const elapsedSeconds = (nowSeconds - FIXED_EPOCH_SECONDS) % channel.totalLoopSeconds;

  let activeItem = channel.items[0];
  let seekOffset = 0;

  for (const item of channel.items) {
    const itemEnd = item.start + item.duration;
    if (elapsedSeconds >= item.start && elapsedSeconds < itemEnd) {
      activeItem = item;
      seekOffset = elapsedSeconds - item.start;
      break;
    }
  }

  const title = activeItem.series ? `${activeItem.series} - ${activeItem.title}` : activeItem.title;

  // Single direct HLS stream link calculated for the currently active show
  const streamUrl = `${JELLYFIN_URL}/Videos/${activeItem.id}/master.m3u8?` +
    `api_key=${apiKey}` +
    `&MediaSourceId=${activeItem.id}` +
    `&VideoCodec=h264` +
    `&AudioCodec=aac` +
    `&AudioChannels=2` +
    `&MaxAudioChannels=2` +
    `&SegmentContainer=ts` +
    `&VideoBitrate=8000000` +
    `&StartTimeTicks=${Math.floor(seekOffset * 10000000)}`; // Tells Jellyfin where to start playing in live time

  // Individual channel file (plays current live point on load)
  const channelM3u = `#EXTM3U\n#EXTINF:-1 tvg-id="${channelId}" tvg-name="${channel.name}", ${channel.name} (Now: ${title})\n${streamUrl}\n`;
  fs.writeFileSync(`${channelId}.m3u`, channelM3u);
  console.log(`Generated ${channelId}.m3u (Live Channel)`);

  // Append entry to Master Live TV Guide
  masterM3u += `#EXTINF:-1 tvg-id="${channelId}" tvg-name="${channel.name}", ${channel.name}\n${streamUrl}\n\n`;
}

fs.writeFileSync('all-channels.m3u', masterM3u);
console.log('Generated all-channels.m3u cleanly!');
