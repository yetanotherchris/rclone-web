class RcloneWeb < Formula
  desc "Web frontend for rclone to manage and run jobs from your browser"
  homepage "https://github.com/yetanotherchris/rclone-web"
  version "1.1.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.1.0/rclone-web-darwin-arm64.tar.gz"
      sha256 "2acfae5d3e95f6376516fd5bcff4988bab1cc58be2e0e41b6d5f346d1c1399b6"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.1.0/rclone-web-darwin-amd64.tar.gz"
      sha256 "6e30e7c47396aec558f7bc77b3cba318f2657043231f0bfe67d0b5a7ce45fc5e"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.1.0/rclone-web-linux-arm64.tar.gz"
      sha256 "0f25057017c968dcf7b5a6f592046a7f32d558286bab262f89a2b5e617ca0e22"
    else
      url "https://github.com/yetanotherchris/rclone-web/releases/download/v1.1.0/rclone-web-linux-amd64.tar.gz"
      sha256 "046756ef0d7dbd6e49ac4ad87d56f0fa59d239e1bce0b5b2dea28276890e4ef1"
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