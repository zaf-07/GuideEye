const baseUrl = process.env.EXPO_PUBLIC_BASE_URL || '/';

module.exports = {
  expo: {
    name: 'GuideEye',
    slug: 'guideeye',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'guideeye',
    userInterfaceStyle: 'dark',
    backgroundColor: '#07110F',
    icon: './assets/icon.png',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.radyn.guideeye',
      infoPlist: {
        NSCameraUsageDescription:
          'GuideEye uses the camera to describe your surroundings, warn about obstacles, and read sign language. Frames are never stored.',
        NSMicrophoneUsageDescription:
          "GuideEye listens so another person's speech can be captioned and translated into sign language.",
        NSSpeechRecognitionUsageDescription:
          'GuideEye transcribes speech so it can be shown as captions and signed back to you.',
        NSLocationWhenInUseUsageDescription:
          'GuideEye uses your location and heading to guide you along pavements, crossings and traffic.',
        NSMotionUsageDescription:
          'GuideEye uses motion sensors to know which way you are facing while navigating.',
        NSLocalNetworkUsageDescription:
          'GuideEye uses the local network to create a private nearby conversation with another GuideEye device.',
        NSBonjourServices: ['_guideeye._tcp'],
      },
    },
    android: {
      package: 'com.guideeye.app',
      versionCode: 1,
      adaptiveIcon: {
        backgroundColor: '#07110F',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      permissions: ['CAMERA', 'RECORD_AUDIO'],
    },
    web: {
      bundler: 'metro',
      output: 'single',
      name: 'GuideEye — accessible AI vision and sign language',
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-asset',
      'expo-sqlite',
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          resizeMode: 'contain',
          backgroundColor: '#07110F',
        },
      ],
      './plugins/withMonorepoOnnx',
      ['expo-camera', { cameraPermission: 'Allow GuideEye to identify nearby objects and obstacles.' }],
      [
        'expo-speech-recognition',
        {
          microphonePermission: 'Allow GuideEye to use the microphone for Bridge replies.',
          speechRecognitionPermission: 'Allow GuideEye to turn spoken Bridge replies into text.',
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Allow GuideEye to provide walking directions while the app is open.',
          motionUsagePermission:
            'Allow GuideEye to use motion to improve heading while navigating.',
          isIosBackgroundLocationEnabled: false,
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      baseUrl,
    },
  },
};
