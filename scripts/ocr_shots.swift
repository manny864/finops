import Foundation
import Vision
import AppKit

let targetDir = "/Users/manuelchavez/Documents/FinOpsProyect/public/video-assets/desktop_shots"
let fileManager = FileManager.default

do {
    let files = try fileManager.contentsOfDirectory(atPath: targetDir).filter { $0.hasSuffix(".png") }.sorted()
    for file in files {
        let filePath = "\(targetDir)/\(file)"
        guard let image = NSImage(contentsOfFile: filePath),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
        
        let requestHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        let request = VNRecognizeTextRequest { request, error in
            guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
            let recognizedStrings = observations.compactMap { $0.topCandidates(1).first?.string }
            let summary = recognizedStrings.prefix(15).joined(separator: " | ")
            print("[\(file)] \(summary)")
        }
        request.recognitionLevel = .accurate
        try requestHandler.perform([request])
    }
} catch {
    print("Error: \(error)")
}
