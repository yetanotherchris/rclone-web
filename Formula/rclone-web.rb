class RcloneWeb < Formula
  desc "Web frontend for rclone to manage and run jobs from your browser"
  homepage "https://github.com/yetanotherchris/rclone-web"
  version "1.0.1"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.1/rclone-web-darwin-arm64.tar.gz"
      sha256 "fb2c3935fb90fea3db302c67edd0bb4c2cd007027905db5f4ceebf83c41a5964"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.1/rclone-web-darwin-amd64.tar.gz"
      sha256 "820da5a72feb0ddd379cd64364898ba86700de0b2aad6912940b126e459e6a3f"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.1/rclone-web-linux-arm64.tar.gz"
      sha256 "54c51da100b5340c2c55beeeb44034df411cd4c7cd8210374d7c0e9c77956a03"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.1/rclone-web-linux-amd64.tar.gz"
      sha256 "f1dd41a402851a606ba17974df5cadc59fff6448406422cd3233dd2dea9590f2"
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