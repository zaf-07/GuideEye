Pod::Spec.new do |s|
  s.name           = 'GuideEyeMultipeer'
  s.version        = '1.0.0'
  s.summary        = 'Nearby peer-to-peer conversations for GuideEye'
  s.description    = 'Finds another GuideEye phone nearby and exchanges messages over Multipeer Connectivity.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'MultipeerConnectivity'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
