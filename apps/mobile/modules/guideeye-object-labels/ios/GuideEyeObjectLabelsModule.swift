import ExpoModulesCore
import ImageIO
import Vision

public class GuideEyeObjectLabelsModule: Module {
  private let classificationQueue = DispatchQueue(label: "GuideEye.objectLabels", qos: .utility)

  public func definition() -> ModuleDefinition {
    Name("GuideEyeObjectLabels")

    AsyncFunction("classify") { (uri: String) -> [[String: Any]] in
      guard let url = URL(string: uri), url.isFileURL,
            let source = CGImageSourceCreateWithURL(url as CFURL, nil),
            let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
              kCGImageSourceCreateThumbnailFromImageAlways: true,
              kCGImageSourceCreateThumbnailWithTransform: true,
              kCGImageSourceThumbnailMaxPixelSize: 384
            ] as CFDictionary) else { return [] }
      let request = VNClassifyImageRequest()
      try VNImageRequestHandler(cgImage: image).perform([request])
      return (request.results ?? []).prefix(12).map {
        ["label": $0.identifier, "confidence": Double($0.confidence)]
      }
    }.runOnQueue(classificationQueue)
  }
}
