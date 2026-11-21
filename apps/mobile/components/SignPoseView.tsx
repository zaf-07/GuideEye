import { View } from 'react-native';
import { HAND_CONNECTIONS, type HandPose } from '../src/aslSignPoses';

export default function SignPoseView({ pose, size, color = '#B7FF56' }: {
  pose: HandPose;
  size: number;
  color?: string;
}) {
  const thickness = Math.max(2, size / 32);
  return (
    <View pointerEvents="none" accessible={false} style={{ width: size, height: size }}>
      {HAND_CONNECTIONS.map(([from, to]) => {
        const a = pose[from];
        const b = pose[to];
        if (!a || !b) return null;
        const dx = (b.x - a.x) * size;
        const dy = (b.y - a.y) * size;
        const width = Math.hypot(dx, dy);
        return <View key={`${from}-${to}`} style={{
          position: 'absolute', left: (a.x + b.x) * size / 2 - width / 2,
          top: (a.y + b.y) * size / 2 - thickness / 2,
          width, height: thickness, borderRadius: thickness, backgroundColor: color,
          transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
        }} />;
      })}
      {pose.map(({ x, y }, i) => <View key={i} style={{
        position: 'absolute', left: x * size - thickness, top: y * size - thickness,
        width: thickness * 2, height: thickness * 2, borderRadius: thickness, backgroundColor: color,
      }} />)}
    </View>
  );
}
