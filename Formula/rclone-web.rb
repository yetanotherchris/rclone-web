class RcloneWeb < Formula
  desc "Web frontend for rclone to manage and run jobs from your browser"
  homepage "https://github.com/yetanotherchris/rclone-web"
  version "1.0.2"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.2/rclone-web-darwin-arm64.tar.gz"
      sha256 "7142b9708653e2ba4adca3dad5559fa6d022c3e74519ae89005b7a3cadcc702c"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.2/rclone-web-darwin-amd64.tar.gz"
      sha256 "ee205082c6d9d942a59dea6c26d0eb997d88862d539cd05cc416e26857dd205e"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.2/rclone-web-linux-arm64.tar.gz"
      sha256 "605cbffb6e62f7c18fc428437891875d433330452c17911169fd59a635906ccd"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.2/rclone-web-linux-amd64.tar.gz"
      sha256 "0b5999720c195354fa58853e7f513e1e00272045fe7cbfcc7e0da2b672c266ae"
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