class RcloneWeb < Formula
  desc "Web frontend for rclone to manage and run jobs from your browser"
  homepage "https://github.com/yetanotherchris/rclone-web"
  version "1.3.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.3.0/rclone-web-darwin-arm64.tar.gz"
      sha256 "6ce37fbf5b53d780534c80457d2fb1a87f57d120cfb662c5fbbf8f9d0d2ecaf9"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.3.0/rclone-web-darwin-amd64.tar.gz"
      sha256 "1bab7d0dac46265490e4f79251034fc92e243a915b5ea605c5154794921fcb7b"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.3.0/rclone-web-linux-arm64.tar.gz"
      sha256 "2fb7333f3e3153bb7b795818b542918de2125841a8e9cb97ee7391df7bd78ac9"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.3.0/rclone-web-linux-amd64.tar.gz"
      sha256 "096228c837a6784cc804fdd3e9dfba57a42881a706347a0e59d8ee859cfc30d7"
    end
  end

  def install
    bin.install "rclone-web-darwin-arm64" => "rclone-web" if OS.mac? && Hardware::CPU.arm?
    bin.install "rclone-web-darwin-amd64" => "rclone-web" if OS.mac? && !Hardware::CPU.arm?
    bin.install "rclone-web-linux-arm64" => "rclone-web" if OS.linux? && Hardware::CPU.arm?
    bin.install "rclone-web-linux-amd64" => "rclone-web" if OS.linux? && !Hardware::CPU.arm?
  end

  test do
    assert_match "rclone-web #{version}", shell_output("#{bin}/rclone-web --version")
  end
end