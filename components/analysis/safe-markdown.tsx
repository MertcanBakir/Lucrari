import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useAppTheme } from '@/context/theme-context';
import { isSafeMarkdownUrl, tokenizeMarkdown } from '@/utils/safe-markdown';

export { sanitizeMarkdownSource, tokenizeMarkdown } from '@/utils/safe-markdown';

function InlineMarkdown({ text, color, linkColor }: { text: string; color: string; linkColor: string }) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https:\/\/[^\s)]+\))/g;
  const parts = text.split(pattern).filter(Boolean);

  return (
    <Text style={{ color }}>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <Text key={index} style={styles.bold}>{part.slice(2, -2)}</Text>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <Text key={index} style={styles.inlineCode}>{part.slice(1, -1)}</Text>;
        }
        const link = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/.exec(part);
        if (link && isSafeMarkdownUrl(link[2])) {
          return (
            <Text
              key={index}
              accessibilityRole="link"
              onPress={() => Linking.openURL(link[2]).catch(() => {})}
              style={[styles.link, { color: linkColor }]}
            >
              {link[1]}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}

export function SafeMarkdown({ source }: { source: string }) {
  const { colorScheme } = useAppTheme();
  const theme = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const blocks = tokenizeMarkdown(source);

  return (
    <View style={styles.container}>
      {blocks.map((block, index) => {
        if (block.type === 'divider') {
          return <View key={index} style={[styles.divider, { backgroundColor: theme.borderSubtle }]} />;
        }
        if (block.type === 'heading') {
          return (
            <Text
              key={index}
              accessibilityRole="header"
              style={[
                styles.heading,
                { color: theme.text, fontSize: Math.max(16, 23 - block.level * 1.5) },
              ]}
            >
              <InlineMarkdown text={block.text} color={theme.text} linkColor={theme.tint} />
            </Text>
          );
        }
        if (block.type === 'bullet' || block.type === 'numbered') {
          return (
            <View key={index} style={styles.listRow}>
              <Text style={[styles.marker, { color: theme.tint }]}>
                {block.type === 'bullet' ? '•' : `${block.number}.`}
              </Text>
              <Text style={styles.listContent}>
                <InlineMarkdown text={block.text} color={theme.text} linkColor={theme.tint} />
              </Text>
            </View>
          );
        }
        if (block.type === 'quote') {
          return (
            <View key={index} style={[styles.quote, { borderLeftColor: theme.tintBorder }]}>
              <Text style={styles.body}>
                <InlineMarkdown text={block.text} color={theme.textSecondary} linkColor={theme.tint} />
              </Text>
            </View>
          );
        }
        if (block.type === 'code') {
          return (
            <View key={index} style={[styles.code, { backgroundColor: theme.backgroundSecondary }]}>
              <Text selectable style={[styles.codeText, { color: theme.text }]}>{block.text}</Text>
            </View>
          );
        }
        return (
          <Text key={index} style={styles.body}>
            <InlineMarkdown text={block.text} color={theme.text} linkColor={theme.tint} />
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  heading: { fontWeight: '800', lineHeight: 26, marginTop: 4 },
  body: { fontSize: 15, lineHeight: 23 },
  bold: { fontWeight: '800' },
  inlineCode: { fontFamily: 'monospace', fontSize: 14 },
  link: { textDecorationLine: 'underline', fontWeight: '600' },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  marker: { width: 22, fontSize: 15, lineHeight: 23, fontWeight: '700', textAlign: 'right' },
  listContent: { flex: 1, fontSize: 15, lineHeight: 23 },
  quote: { borderLeftWidth: 3, paddingLeft: 12 },
  code: { borderRadius: 10, padding: 12 },
  codeText: { fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
