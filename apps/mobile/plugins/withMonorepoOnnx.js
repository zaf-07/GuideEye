const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');
const fs = require('fs');
const path = require('path');

/**
 * onnxruntime-react-native's bundled plugin assumes the Expo app is at the
 * repository root. GuideEye is an npm workspace, so its package is hoisted two
 * levels above apps/mobile. Keep the upstream Android setup and correct only
 * the generated iOS pod path.
 */
module.exports = (config) => {
  const configured = withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') {
      throw new Error('ONNX Runtime requires a Groovy Android build file');
    }
    modConfig.modResults.contents = mergeContents({
      src: modConfig.modResults.contents,
      newSrc: "    implementation project(':onnxruntime-react-native')",
      tag: 'onnxruntime-react-native',
      anchor: /^dependencies[ \t]*\{$/,
      offset: 1,
      comment: '    // onnxruntime-react-native',
    }).contents;
    return modConfig;
  });

  return withDangerousMod(configured, [
    'ios',
    (modConfig) => {
      const podfile = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      const source = fs.readFileSync(podfile, 'utf8');
      const corrected = mergeContents({
        src: source,
        newSrc:
          "  pod 'onnxruntime-react-native', :path => '../../../node_modules/onnxruntime-react-native'",
        tag: 'onnxruntime-react-native',
        anchor: /^target.+do$/,
        offset: 1,
        comment: '  # onnxruntime-react-native',
      }).contents;
      fs.writeFileSync(podfile, corrected);
      return modConfig;
    },
  ]);
};
