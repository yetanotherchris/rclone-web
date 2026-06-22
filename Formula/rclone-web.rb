class RcloneWeb < Formula
  desc "Web frontend for rclone to manage and run jobs from your browser"
  homepage "https://github.com/yetanotherchris/rclone-web"
  version "1.0.3"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.3/rclone-web-darwin-arm64.tar.gz"
      sha256 "fc3c694fd3c0618607cf75dccda3251938f1fbfe83ebfc9e71abb7ed917f82e5"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.3/rclone-web-darwin-amd64.tar.gz"
      sha256 "ac9aa98889cd4a244c750f37f19ec5c9c05ab2b90523072d784f0817acceb9d8"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.3/rclone-web-linux-arm64.tar.gz"
      sha256 "b6ba8c4b2af6f78531b6351ab97795e77e5d5c2a497bd3e82ac928166c55505e"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.0.3/rclone-web-linux-amd64.tar.gz"
      sha256 "0190fdb999e790b5c695b7e7214171d591e51feec9591bb3dcf9adcf9adac572"
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