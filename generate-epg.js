const fs = require('fs');

if (!fs.existsSync('channels.json')) {
  console.error('Error: channels.json not found!');
  process.exit(1);
}

const schedule = JSON.parse(fs.readFileSync('channels.json', 'utf8'));

// EPG Configuration
const guideDays = 2; // Generate 48 hours of EPG data
const nowSeconds = Math.floor(Date.now() / 1000);
const endSeconds = nowSeconds + (guideDays * 24 * 60 * 60);
const FIXED_EPOCH_SECONDS = 1767225600; 

// Helper to escape special characters for XML
const escapeXml = (unsafe) => (unsafe || '').replace(/[<>&'"]/g, (c) => {
  switch (c) {
    case '<': return '&lt;'; case '>': return '&gt;';
    case '&': return '&amp;'; case '\'': return '&apos;';
    case '"': return '&quot;'; default: return c;
  }
});

// Helper to format UNIX time to XMLTV standard (YYYYMMDDHHMMSS +0000)
// EPG clients automatically read the +0000 UTC marker and adjust it to your local time.
const formatXmltvDate = (unixSeconds) => {
  const d = new Date(unixSeconds * 1000);
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
};

let xmltv = `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="Nostalgex TV">\n`;

// 1. Build Channel List
for (const [channelId, channel] of Object.entries(schedule.channels)) {
  xmltv += `  <channel id="${channelId}">\n`;
  xmltv += `    <display-name>${escapeXml(channel.name)}</display-name>\n`;
  xmltv += `  </channel>\n`;
}

// 2. Build Programme Data
for (const [channelId, channel] of Object.entries(schedule.channels)) {
  const loopPosition = (nowSeconds - FIXED_EPOCH_SECONDS) % channel.totalLoopSeconds;
  
  // Find which item is currently playing
  let itemIndex = 0;
  for (let i = 0; i < channel.items.length; i++) {
    const item = channel.items[i];
    if (loopPosition >= item.start && loopPosition < item.start + item.duration) {
      itemIndex = i;
      break;
    }
  }

  // Calculate the absolute real-world start time of the current item
  let currentStartAbsolute = nowSeconds - (loopPosition - channel.items[itemIndex].start);

  // Roll forward and generate programs until we hit the 48-hour limit
  while (currentStartAbsolute < endSeconds) {
    const item = channel.items[itemIndex];
    const startStr = formatXmltvDate(currentStartAbsolute);
    const stopStr = formatXmltvDate(currentStartAbsolute + item.duration);
    
    const title = item.series ? item.series : item.title;
    const subTitle = item.series ? item.title : '';

    xmltv += `  <programme start="${startStr}" stop="${stopStr}" channel="${channelId}">\n`;
    xmltv += `    <title lang="en">${escapeXml(title)}</title>\n`;
    if (subTitle) xmltv += `    <sub-title lang="en">${escapeXml(subTitle)}</sub-title>\n`;
    xmltv += `  </programme>\n`;

    // Advance to the next show, loop to the beginning if we hit the end of the array
    currentStartAbsolute += item.duration;
    itemIndex = (itemIndex + 1) % channel.items.length;
  }
}

xmltv += `</tv>\n`;

fs.writeFileSync('epg.xml', xmltv);
console.log('Generated epg.xml successfully!');
