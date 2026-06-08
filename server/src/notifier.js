const nodemailer = require('nodemailer');
const {
  listNotificationChannels,
  getActiveSilences,
  markAlertNotified,
  getUnnotifiedFiringAlerts
} = require('./database');

function matchSilence(alert, silence) {
  try {
    let matchers = silence.matchers;
    if (typeof matchers === 'string') {
      try {
        matchers = JSON.parse(matchers);
      } catch (e) {
        console.error('Failed to parse silence matchers:', matchers);
        return false;
      }
    }
    
    if (!Array.isArray(matchers)) {
      return false;
    }
    
    let alertTags = alert.tags;
    if (typeof alertTags === 'string') {
      try {
        alertTags = JSON.parse(alertTags);
      } catch (e) {
        alertTags = {};
      }
    }
    alertTags = alertTags || {};

    for (const matcher of matchers) {
      const { name, value, isRegex, isEqual } = matcher;

      let alertValue;
      if (name === 'metric') {
        alertValue = alert.metric;
      } else {
        alertValue = alertTags[name];
      }

      if (alertValue === undefined || alertValue === null) {
        if (isEqual) return false;
        continue;
      }

      const alertValueStr = String(alertValue);
      const valueStr = String(value);

      let matches;
      if (isRegex) {
        try {
          const regex = new RegExp(valueStr);
          matches = regex.test(alertValueStr);
        } catch (e) {
          console.error('Invalid regex in silence matcher:', valueStr);
          return false;
        }
      } else {
        matches = alertValueStr === valueStr;
      }

      if (isEqual ? !matches : matches) {
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error('Error matching silence:', err);
    return false;
  }
}

async function sendWebhookNotification(channelConfig, alert) {
  try {
    const headers = channelConfig.headers || { 'Content-Type': 'application/json' };
    headers['Content-Type'] = 'application/json';

    const response = await fetch(channelConfig.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        alert,
        timestamp: Date.now()
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook failed with status ${response.status}`);
    }

    return true;
  } catch (err) {
    console.error('Webhook notification error:', err);
    throw err;
  }
}

async function sendSMTPNotification(channelConfig, alerts) {
  try {
    const transport = nodemailer.createTransport(channelConfig.smtp);

    const alertSummary = alerts.map(alert => {
      const tags = alert.tags ? JSON.parse(alert.tags) : {};
      const tagStr = Object.entries(tags)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `
Alert ID: ${alert.id}
Metric: ${alert.metric}
Value: ${alert.value} ${alert.operator} ${alert.threshold}
Severity: ${alert.severity || 'warning'}
Started: ${new Date(alert.start_ts).toISOString()}
Tags: ${tagStr || 'none'}
      `.trim();
    }).join('\n\n');

    const subject = `[ALERT] ${alerts.length} firing alert${alerts.length > 1 ? 's' : ''}`;
    const text = `The following alert${alerts.length > 1 ? 's are' : ' is'} currently firing:\n\n${alertSummary}`;

    await transport.sendMail({
      from: channelConfig.from,
      to: channelConfig.to,
      subject,
      text
    });

    return true;
  } catch (err) {
    console.error('SMTP notification error:', err);
    throw err;
  }
}

async function processNotifications() {
  try {
    const channels = listNotificationChannels().filter(c => c.enabled === 1);
    const silences = getActiveSilences();
    const alerts = getUnnotifiedFiringAlerts();

    if (alerts.length === 0) {
      return;
    }

    const channelMap = new Map();
    for (const channel of channels) {
      channelMap.set(channel.id, channel);
    }

    const nonSilencedAlerts = [];
    for (const alert of alerts) {
      let isSilenced = false;
      for (const silence of silences) {
        if (matchSilence(alert, silence)) {
          isSilenced = true;
          break;
        }
      }
      if (!isSilenced) {
        nonSilencedAlerts.push(alert);
      }
    }

    const alertGroups = new Map();
    for (const alert of nonSilencedAlerts) {
      const groupKey = alert.group_key || `ungrouped-${alert.id}`;
      if (!alertGroups.has(groupKey)) {
        alertGroups.set(groupKey, []);
      }
      alertGroups.get(groupKey).push(alert);
    }

    for (const [groupKey, groupAlerts] of alertGroups) {
      if (groupAlerts.length === 0) continue;

      const firstAlert = groupAlerts[0];
      let notificationChannelIds = [];
      try {
        if (firstAlert.notification_channels) {
          notificationChannelIds = JSON.parse(firstAlert.notification_channels);
        }
      } catch (err) {
        console.error('Error parsing notification_channels:', err);
        continue;
      }

      if (!Array.isArray(notificationChannelIds) || notificationChannelIds.length === 0) {
        continue;
      }

      for (const channelId of notificationChannelIds) {
        const channel = channelMap.get(channelId);
        if (!channel) {
          console.error(`Notification channel ${channelId} not found`);
          continue;
        }

        try {
          const channelConfig = JSON.parse(channel.config);

          if (channel.type === 'webhook') {
            for (const alert of groupAlerts) {
              await sendWebhookNotification(channelConfig, alert);
            }
          } else if (channel.type === 'smtp') {
            await sendSMTPNotification(channelConfig, groupAlerts);
          } else {
            console.error(`Unknown notification channel type: ${channel.type}`);
            continue;
          }

          for (const alert of groupAlerts) {
            markAlertNotified(alert.id);
          }
        } catch (err) {
          console.error(`Error sending notification to channel ${channel.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Error processing notifications:', err);
  }
}

module.exports = {
  processNotifications,
  matchSilence
};
