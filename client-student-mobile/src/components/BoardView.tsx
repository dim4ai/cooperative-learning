import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { STUDENT_WEB_URL } from '../config';

interface Props {
  myName: string;
  room: string;
  readOnly?: boolean;
}

export function BoardView({ myName, room, readOnly }: Props) {
  const url =
    `${STUDENT_WEB_URL}/?boardonly=1` +
    `&name=${encodeURIComponent(myName)}` +
    `&room=${encodeURIComponent(room)}` +
    (readOnly ? '&readonly=1' : '');

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: url }}
        style={styles.webview}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
});
