class RcloneWeb < Formula
  desc "Web frontend for rclone to manage and run jobs from your browser"
  homepage "https://github.com/yetanotherchris/rclone-web"
  version "1.2.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.2.0/rclone-web-darwin-arm64.tar.gz"
      sha256 "8930972471c522b08ad9d013d53c0717a46570b880d46f670286ed611b0cfc0c"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.2.0/rclone-web-darwin-amd64.tar.gz"
      sha256 "edc878176f550efea4d67ad59b2b8b7dc84467dd9f8877c536044051a55b37cc"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.2.0/rclone-web-linux-arm64.tar.gz"
      sha256 "e05b3ab5e782e76caca8b8e30d8fc432452fc9989938da1d44260343b56cce4a"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.2.0/rclone-web-linux-amd64.tar.gz"
      sha256 "bdc0856b37e92af7fbb1d49678f33be7b179e60ebab3de9f1b3707f2f3e4aa9f"
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