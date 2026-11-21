import { Image, StyleSheet, Text, View } from 'react-native';

// Same Wikimedia Commons Sign_language_<letter>.svg illustrations as GuideBand.
const illustrations: Record<string, number> = {
  A: require('../assets/asl-alphabet/A.png'),
  B: require('../assets/asl-alphabet/B.png'),
  C: require('../assets/asl-alphabet/C.png'),
  D: require('../assets/asl-alphabet/D.png'),
  E: require('../assets/asl-alphabet/E.png'),
  F: require('../assets/asl-alphabet/F.png'),
  G: require('../assets/asl-alphabet/G.png'),
  H: require('../assets/asl-alphabet/H.png'),
  I: require('../assets/asl-alphabet/I.png'),
  J: require('../assets/asl-alphabet/J.png'),
  K: require('../assets/asl-alphabet/K.png'),
  L: require('../assets/asl-alphabet/L.png'),
  M: require('../assets/asl-alphabet/M.png'),
  N: require('../assets/asl-alphabet/N.png'),
  O: require('../assets/asl-alphabet/O.png'),
  P: require('../assets/asl-alphabet/P.png'),
  Q: require('../assets/asl-alphabet/Q.png'),
  R: require('../assets/asl-alphabet/R.png'),
  S: require('../assets/asl-alphabet/S.png'),
  T: require('../assets/asl-alphabet/T.png'),
  U: require('../assets/asl-alphabet/U.png'),
  V: require('../assets/asl-alphabet/V.png'),
  W: require('../assets/asl-alphabet/W.png'),
  X: require('../assets/asl-alphabet/X.png'),
  Y: require('../assets/asl-alphabet/Y.png'),
  Z: require('../assets/asl-alphabet/Z.png'),
};

function LetterCard({ letter }: { letter: string }) {
  return (
    <View style={styles.card} accessible accessibilityLabel={`ASL letter ${letter}`}>
      <Image
        source={illustrations[letter]}
        style={styles.image}
        resizeMode="contain"
        accessible={false}
      />
      <Text style={styles.letter}>{letter}</Text>
    </View>
  );
}

export default function FingerspellingCards({ text }: { text: string }) {
  const words = text.match(/[a-z]+(?:['’][a-z]+)*/gi) ?? [];
  return (
    <View style={styles.group}>
      {words.map((word, index) => (
        <View key={`${index}-${word}`} style={styles.line}>
          <Text style={styles.label}>{word}</Text>
          <View style={styles.row}>
            {Array.from(word.toUpperCase().replace(/[^A-Z]/g, '')).map((letter, i) => (
              <LetterCard key={i} letter={letter} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 12, padding: 12, backgroundColor: '#E9F7EF', borderRadius: 16 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  card: { width: 50, backgroundColor: '#fff', borderRadius: 11, padding: 4, alignItems: 'center' },
  image: { width: 42, height: 48 },
  label: { width: '25%', color: '#07120F', fontSize: 18, fontWeight: '700' },
  letter: { color: '#07120F', fontSize: 16, fontWeight: '700' },
});
